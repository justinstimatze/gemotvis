package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
	"github.com/justinstimatze/gemotvis/internal/hub"
	"github.com/justinstimatze/gemotvis/internal/poller"
)

const (
	maxWatchSessions    = 20
	watchSessionTimeout = 1 * time.Hour
	watchPollInterval   = 10 * time.Second
)

// joinCodeInfo is the response from gemot's /join/<code> endpoint.
type joinCodeInfo struct {
	Code           string `json:"code"`
	DeliberationID string `json:"deliberation_id"`
	Topic          string `json:"topic"`
	Role           string `json:"role"`
	Expired        bool   `json:"expired"`
	ExpiresAt      string `json:"expires_at"`
}

// watchSession tracks a live-watched deliberation.
type watchSession struct {
	code       string
	delibID    string
	poller     *poller.Poller
	hub        *hub.Hub
	lastAccess atomic.Int64 // unix timestamp, safe for concurrent access
	cancel     context.CancelFunc
}

func (ws *watchSession) touch()                { ws.lastAccess.Store(time.Now().Unix()) }
func (ws *watchSession) idleSince() time.Duration { return time.Since(time.Unix(ws.lastAccess.Load(), 0)) }

// watchManager handles all active watch sessions.
type watchManager struct {
	mu       sync.RWMutex
	sessions map[string]*watchSession // keyed by join code
	gemotURL string
	apiKey   string
	done     chan struct{}
}

func newWatchManager(gemotURL, apiKey string) *watchManager {
	wm := &watchManager{
		sessions: make(map[string]*watchSession),
		gemotURL: gemotURL,
		apiKey:   apiKey,
		done:     make(chan struct{}),
	}
	go wm.reapLoop()
	return wm
}

func (wm *watchManager) reapLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			wm.reap()
		case <-wm.done:
			return
		}
	}
}

// Close stops the reap loop and cleans up all sessions.
func (wm *watchManager) Close() {
	close(wm.done)
	wm.mu.Lock()
	defer wm.mu.Unlock()
	for code, sess := range wm.sessions {
		sess.cancel()
		delete(wm.sessions, code)
	}
}

// getOrCreate looks up a join code with gemot, then returns or creates a watch session.
func (wm *watchManager) getOrCreate(code string) (*watchSession, error) {
	wm.mu.RLock()
	if sess, ok := wm.sessions[code]; ok {
		sess.touch()
		wm.mu.RUnlock()
		return sess, nil
	}
	wm.mu.RUnlock()

	// Validate code format (lowercase alphanumeric + hyphens only)
	for _, c := range code {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return nil, fmt.Errorf("invalid code format")
		}
	}
	if len(code) < 5 || len(code) > 100 {
		return nil, fmt.Errorf("invalid code format")
	}

	// Look up the join code with gemot
	info, err := wm.lookupCode(code)
	if err != nil {
		return nil, err
	}
	if info.Expired {
		return nil, fmt.Errorf("join code expired")
	}
	if info.DeliberationID == "" {
		return nil, fmt.Errorf("invalid join code")
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	// Double-check after acquiring write lock
	if sess, ok := wm.sessions[code]; ok {
		sess.touch()
		return sess, nil
	}

	if len(wm.sessions) >= maxWatchSessions {
		return nil, fmt.Errorf("too many active watch sessions")
	}

	// Create a new poller for this deliberation
	client := gemot.NewClient(wm.gemotURL, wm.apiKey)
	h := hub.New()
	ctx, cancel := context.WithCancel(context.Background())
	p := poller.New(client, h, watchPollInterval, info.DeliberationID)
	p.EnableSSE() // push events from gemot for near-instant updates

	go p.Run(ctx)

	sess := &watchSession{
		code:    code,
		delibID: info.DeliberationID,
		poller:  p,
		hub:     h,
		cancel:  cancel,
	}
	sess.touch()
	wm.sessions[code] = sess

	log.Printf("watch: new session for %s (deliberation %s)", code, info.DeliberationID)
	return sess, nil
}

func (wm *watchManager) lookupCode(code string) (*joinCodeInfo, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", wm.gemotURL+"/join/"+code, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("lookup: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("join code not found")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemot returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var info joinCodeInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}
	return &info, nil
}

func (wm *watchManager) reap() {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	for code, sess := range wm.sessions {
		idle := sess.idleSince()
		if idle > watchSessionTimeout {
			log.Printf("watch: reaping session %s (idle %s)", code, idle.Round(time.Second))
			sess.cancel()
			delete(wm.sessions, code)
		}
	}
}

// handleWatchState returns the current snapshot for a join-code session.
func (s *Server) handleWatchState(w http.ResponseWriter, r *http.Request) {
	code := extractWatchCode(r.URL.Path, "/api/watch/", "/state")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	if s.watches == nil {
		http.Error(w, "watch mode not available", http.StatusServiceUnavailable)
		return
	}

	sess, err := s.watches.getOrCreate(code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sess.poller.GetSnapshot()) //nolint:errcheck
}

// handleWatchEvents returns an SSE stream for a join-code session.
func (s *Server) handleWatchEvents(w http.ResponseWriter, r *http.Request) {
	code := extractWatchCode(r.URL.Path, "/api/watch/", "/events")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	if s.watches == nil {
		http.Error(w, "watch mode not available", http.StatusServiceUnavailable)
		return
	}

	sess, err := s.watches.getOrCreate(code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Rate limit SSE connections
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

	ch, unsub := sess.hub.Subscribe()
	defer unsub()

	// Send initial snapshot
	snapshot, _ := json.Marshal(map[string]any{
		"type": "snapshot",
		"data": sess.poller.GetSnapshot(),
	})
	fmt.Fprintf(w, "data: %s\n\n", snapshot)
	flusher.Flush()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
			sess.touch()
		case <-ping.C:
			fmt.Fprintf(w, "data: {\"type\":\"ping\"}\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// extractWatchCode pulls the join code from a URL path like /api/watch/bold-cedar-123/state
func extractWatchCode(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	path = strings.TrimSuffix(path, suffix)
	if path == "" || strings.Contains(path, "/") {
		return ""
	}
	return path
}
