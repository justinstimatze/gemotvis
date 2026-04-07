package server

import (
	"context"
	"encoding/json"
	"fmt"
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
	maxGroupSessions    = 20
	groupSessionTimeout = 2 * time.Hour
	groupPollInterval   = 10 * time.Second
)

// groupSession tracks a shared group view (all deliberations in a group).
type groupSession struct {
	groupID    string
	poller     *poller.Poller
	hub        *hub.Hub
	lastAccess atomic.Int64
	cancel     context.CancelFunc
}

func (gs *groupSession) touch()                    { gs.lastAccess.Store(time.Now().Unix()) }
func (gs *groupSession) idleSince() time.Duration  { return time.Since(time.Unix(gs.lastAccess.Load(), 0)) }

// groupManager handles shared group viewing sessions.
type groupManager struct {
	mu       sync.RWMutex
	sessions map[string]*groupSession // keyed by group ID
	gemotURL string
	apiKey   string
	done     chan struct{}
}

func newGroupManager(gemotURL, apiKey string) *groupManager {
	gm := &groupManager{
		sessions: make(map[string]*groupSession),
		gemotURL: gemotURL,
		apiKey:   apiKey,
		done:     make(chan struct{}),
	}
	go gm.reapLoop()
	return gm
}

func (gm *groupManager) reapLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			gm.reap()
		case <-gm.done:
			return
		}
	}
}

// Close stops the reap loop and cleans up all sessions.
func (gm *groupManager) Close() {
	close(gm.done)
	gm.mu.Lock()
	defer gm.mu.Unlock()
	for id, sess := range gm.sessions {
		sess.cancel()
		delete(gm.sessions, id)
	}
}

func (gm *groupManager) reap() {
	gm.mu.Lock()
	defer gm.mu.Unlock()
	for id, sess := range gm.sessions {
		if sess.idleSince() > groupSessionTimeout {
			truncID := id
			if len(truncID) > 16 {
				truncID = truncID[:16]
			}
			log.Printf("group: reaping session %s", truncID)
			sess.cancel()
			delete(gm.sessions, id)
		}
	}
}

// getOrCreate returns or creates a group viewing session.
// The group ID must exist and contain at least one deliberation.
func (gm *groupManager) getOrCreate(groupID string) (*groupSession, error) {
	gm.mu.RLock()
	if sess, ok := gm.sessions[groupID]; ok {
		sess.touch()
		gm.mu.RUnlock()
		return sess, nil
	}
	gm.mu.RUnlock()

	// Validate group ID format (alphanumeric + hyphens + underscores)
	for _, c := range groupID {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') { //nolint:staticcheck // clearer than De Morgan's
			return nil, fmt.Errorf("invalid group ID format")
		}
	}
	if len(groupID) < 5 || len(groupID) > 200 {
		return nil, fmt.Errorf("invalid group ID format")
	}

	// Verify the group exists by fetching its deliberations
	client := gemot.NewClient(gm.gemotURL, gm.apiKey)
	delibs, err := client.ListByGroup(context.Background(), groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch group: %w", err)
	}
	if len(delibs) == 0 {
		return nil, fmt.Errorf("group not found or empty")
	}

	gm.mu.Lock()
	defer gm.mu.Unlock()

	// Double-check after lock
	if sess, ok := gm.sessions[groupID]; ok {
		sess.touch()
		return sess, nil
	}

	if len(gm.sessions) >= maxGroupSessions {
		return nil, fmt.Errorf("too many active group sessions")
	}

	// Create a poller that watches all deliberations in the group.
	// Pass empty deliberation ID = poll all (the poller will use ListDeliberations).
	// But we want only this group's deliberations, so we use the IDs we fetched.
	h := hub.New()
	ctx, cancel := context.WithCancel(context.Background())

	// Build comma-separated IDs for the poller
	var ids []string
	for _, d := range delibs {
		ids = append(ids, d.ID)
	}
	p := poller.NewMulti(client, h, groupPollInterval, ids)
	p.EnableSSE() // push events from gemot for near-instant updates
	go p.Run(ctx)

	sess := &groupSession{
		groupID: groupID,
		poller:  p,
		hub:     h,
		cancel:  cancel,
	}
	sess.touch()
	gm.sessions[groupID] = sess

	truncID := groupID
	if len(truncID) > 16 {
		truncID = truncID[:16]
	}
	log.Printf("group: new session for %s (%d deliberations)", truncID, len(delibs))
	return sess, nil
}

// handleGroupState returns the current snapshot for a group.
func (s *Server) handleGroupState(w http.ResponseWriter, r *http.Request) {
	if s.groups == nil {
		http.Error(w, "group viewing not enabled", http.StatusServiceUnavailable)
		return
	}

	groupID := extractGroupID(r.URL.Path)
	if groupID == "" {
		http.Error(w, "group ID required", http.StatusBadRequest)
		return
	}

	sess, err := s.groups.getOrCreate(groupID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sess.poller.GetSnapshot()) //nolint:errcheck
}

// handleGroupEvents streams SSE events for a group.
func (s *Server) handleGroupEvents(w http.ResponseWriter, r *http.Request) {
	if s.groups == nil {
		http.Error(w, "group viewing not enabled", http.StatusServiceUnavailable)
		return
	}

	groupID := extractGroupID(r.URL.Path)
	if groupID == "" {
		http.Error(w, "group ID required", http.StatusBadRequest)
		return
	}

	sess, err := s.groups.getOrCreate(groupID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	if s.sseClients.Add(1) > maxSSEClients {
		s.sseClients.Add(-1)
		http.Error(w, "too many clients", http.StatusServiceUnavailable)
		return
	}
	defer s.sseClients.Add(-1)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Send initial snapshot
	snap := sess.poller.GetSnapshot()
	snapJSON, _ := json.Marshal(map[string]any{"type": "snapshot", "data": snap})
	fmt.Fprintf(w, "data: %s\n\n", snapJSON) //nolint:errcheck // SSE write
	flusher.Flush()

	ch, unsub := sess.hub.Subscribe()
	defer unsub()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg) //nolint:errcheck // SSE write
			flusher.Flush()
			sess.touch()
		case <-ping.C:
			fmt.Fprintf(w, "data: {\"type\":\"ping\"}\n\n") //nolint:errcheck // SSE write
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// extractGroupID pulls the group ID from paths like /api/g/<group_id>/state
func extractGroupID(path string) string {
	path = strings.TrimPrefix(path, "/api/g/")
	if idx := strings.Index(path, "/"); idx != -1 {
		path = path[:idx]
	}
	if path == "" || strings.Contains(path, "/") {
		return ""
	}
	return path
}
