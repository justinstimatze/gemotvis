package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/justinstimatze/gemotvis/internal/hub"
	"github.com/justinstimatze/gemotvis/internal/poller"
)

//go:embed all:static
var staticFS embed.FS

const maxSSEClients = 50

type Server struct {
	poller        *poller.Poller
	hub           *hub.Hub
	mux           *http.ServeMux
	sseClients    atomic.Int64
	snapshot      *poller.Snapshot // static snapshot for demo/replay modes
	cycleInterval time.Duration   // auto-cycle interval for demo mode (0 = disabled)
	watches       *watchManager      // join code watch sessions (nil if no service key)
	dashboards    *dashboardManager  // user dashboard sessions (nil if no gemot URL)
}

// New creates a server for live monitoring.
func New(p *poller.Poller, h *hub.Hub) *Server {
	s := &Server{
		poller: p,
		hub:    h,
		mux:    http.NewServeMux(),
	}
	s.routes()
	return s
}

// NewDemo creates a server with built-in sample data and optional auto-cycling.
// If gemotURL and serviceKey are provided, live watching via join codes is also enabled.
func NewDemo(cycleInterval time.Duration, gemotURL, serviceKey string) *Server {
	s := &Server{
		mux:           http.NewServeMux(),
		snapshot:      demoSnapshot(),
		cycleInterval: cycleInterval,
	}
	if gemotURL != "" && serviceKey != "" {
		s.watches = newWatchManager(gemotURL, serviceKey)
		s.dashboards = newDashboardManager(gemotURL, serviceKey)
	}
	s.routes()
	return s
}

// NewReplay creates a server displaying a loaded snapshot.
func NewReplay(snapshot *poller.Snapshot) *Server {
	s := &Server{
		mux:      http.NewServeMux(),
		snapshot: snapshot,
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/state", s.handleState)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)
	s.mux.HandleFunc("GET /api/config", s.handleConfig)

	// Dashboard routes (API key session auth)
	s.mux.HandleFunc("POST /api/session", s.handleSessionCreate)
	s.mux.HandleFunc("DELETE /api/session", s.handleSessionDelete)
	s.mux.HandleFunc("GET /api/dashboard/state", s.handleDashboardState)
	s.mux.HandleFunc("GET /api/dashboard/events", s.handleDashboardEvents)

	// Watch routes (join code live viewing)
	s.mux.HandleFunc("GET /api/watch/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/state") {
			s.handleWatchState(w, r)
		} else if strings.HasSuffix(r.URL.Path, "/events") {
			s.handleWatchEvents(w, r)
		} else {
			http.Error(w, "not found", http.StatusNotFound)
		}
	})

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(staticSub))
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			f, err := staticSub.Open(r.URL.Path[1:])
			if err != nil {
				r.URL.Path = "/"
			} else {
				f.Close()
			}
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) getSnapshot() *poller.Snapshot {
	if s.snapshot != nil {
		return s.snapshot
	}
	if s.poller != nil {
		return s.poller.GetSnapshot()
	}
	return &poller.Snapshot{Deliberations: map[string]*poller.DelibState{}}
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.getSnapshot()) //nolint:errcheck
}

// handleConfig returns client-side configuration (cycle interval, mode).
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	mode := "live"
	if s.snapshot != nil && s.poller == nil {
		if s.cycleInterval > 0 {
			mode = "demo"
		} else {
			mode = "replay"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"mode":           mode,
		"cycle_interval": s.cycleInterval.Milliseconds(),
		"watch_enabled":     s.watches != nil,
		"dashboard_enabled": s.dashboards != nil,
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	current := s.sseClients.Add(1)
	defer s.sseClients.Add(-1)
	if current > maxSSEClients {
		http.Error(w, "too many connections", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	snapshotData := s.getSnapshot()

	var ch <-chan []byte
	var unsub func()
	if s.hub != nil {
		ch, unsub = s.hub.Subscribe()
		defer unsub()
	} else {
		dummy := make(chan []byte)
		ch = dummy
		unsub = func() {}
		defer unsub()
	}

	// Send initial snapshot
	snapshot, _ := json.Marshal(map[string]any{
		"type": "snapshot",
		"data": snapshotData,
	})
	fmt.Fprintf(w, "data: %s\n\n", snapshot)
	flusher.Flush()

	// Keepalive + optional cycle timer
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	var cycleCh <-chan time.Time
	if s.cycleInterval > 0 {
		cycleTick := time.NewTicker(s.cycleInterval)
		defer cycleTick.Stop()
		cycleCh = cycleTick.C
	}

	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ping.C:
			fmt.Fprintf(w, "data: {\"type\":\"ping\"}\n\n")
			flusher.Flush()
		case <-cycleCh:
			fmt.Fprintf(w, "data: {\"type\":\"cycle\"}\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
