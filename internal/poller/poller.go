package poller

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
	"github.com/justinstimatze/gemotvis/internal/hub"
)

// DelibState holds the complete visualization state for one deliberation.
type DelibState struct {
	Deliberation *gemot.Deliberation  `json:"deliberation"`
	Positions    []gemot.Position     `json:"positions"`
	Votes        []gemot.Vote         `json:"votes"`
	Analysis     *gemot.AnalysisResult `json:"analysis,omitempty"`
	AuditLog     *gemot.AuditLog      `json:"audit_log,omitempty"`
	Agents       []AgentInfo          `json:"agents"`
}

// AgentInfo is derived from positions/votes for the frontend.
type AgentInfo struct {
	ID          string   `json:"id"`
	ModelFamily string   `json:"model_family"`
	Conviction  float64  `json:"conviction"`
	ClusterID   *int     `json:"cluster_id,omitempty"`
	X           *float64 `json:"x,omitempty"`   // 0-100, optional positioned layout
	Y           *float64 `json:"y,omitempty"`   // 0-100, optional positioned layout
	Lat         *float64 `json:"lat,omitempty"` // latitude for world map projection
	Lon         *float64 `json:"lon,omitempty"` // longitude for world map projection
}

// Snapshot is the full state of all watched deliberations.
type Snapshot struct {
	Deliberations map[string]*DelibState `json:"deliberations"`
	FetchedAt     time.Time              `json:"fetched_at"`
}

type Poller struct {
	client    *gemot.Client
	hub       *hub.Hub
	interval  time.Duration
	delibID   string   // if set, watch only this deliberation
	delibIDs  []string // if set, watch these specific deliberations
	sseEvents bool     // if true, connect to gemot SSE /events for push notifications

	mu       sync.RWMutex
	current  *Snapshot
	hashes   map[string]string // deliberation_id -> hash of state; only accessed from the single Run() goroutine via poll()
}

func New(client *gemot.Client, h *hub.Hub, interval time.Duration, delibID string) *Poller {
	return &Poller{
		client:   client,
		hub:      h,
		interval: interval,
		delibID:  delibID,
		current: &Snapshot{
			Deliberations: make(map[string]*DelibState),
		},
		hashes: make(map[string]string),
	}
}

func (p *Poller) GetSnapshot() *Snapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.current
}

// EnableSSE opts the poller into listening for gemot SSE push events.
// When enabled, the poller connects to gemot's /events endpoint and
// re-fetches state immediately on each event, with the timer as fallback.
func (p *Poller) EnableSSE() { p.sseEvents = true }

func (p *Poller) Run(ctx context.Context) {
	// Initial fetch
	p.poll(ctx)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	// SSE push: trigger immediate re-fetch on gemot events
	notify := make(chan struct{}, 1)
	if p.sseEvents {
		go p.listenSSE(ctx, notify)
	}

	for {
		select {
		case <-ticker.C:
			p.poll(ctx)
		case <-notify:
			p.poll(ctx)
		case <-ctx.Done():
			return
		}
	}
}

// listenSSE connects to gemot's /events SSE endpoint and sends on notify
// whenever a relevant event arrives. Reconnects automatically on failure.
func (p *Poller) listenSSE(ctx context.Context, notify chan<- struct{}) {
	baseURL := p.client.BaseURL()
	token := p.client.BearerToken()

	// Build the events URL with optional deliberation filter
	eventsURL := baseURL + "/events?token=" + token
	if p.delibID != "" {
		eventsURL += "&deliberation_id=" + p.delibID
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := p.readSSEStream(ctx, eventsURL, notify); err != nil {
			log.Printf("sse: connection lost: %v (reconnecting in 5s)", err)
		}

		// Backoff before reconnecting
		select {
		case <-time.After(5 * time.Second):
		case <-ctx.Done():
			return
		}
	}
}

// readSSEStream opens a single SSE connection and reads events until error or context cancellation.
func (p *Poller) readSSEStream(ctx context.Context, url string, notify chan<- struct{}) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, body)
	}

	log.Printf("sse: connected to %s", p.client.BaseURL()+"/events")

	// Line-based SSE reading — detect event types that warrant a re-fetch.
	// Using bufio.Scanner avoids buffer-boundary splits on event type strings.
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "position_submitted") ||
			strings.Contains(line, "vote_cast") ||
			strings.Contains(line, "analysis_started") ||
			strings.Contains(line, "analysis_progress") ||
			strings.Contains(line, "analysis_complete") ||
			strings.Contains(line, "deliberation_created") {
			select {
			case notify <- struct{}{}:
			default:
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.EOF // stream ended cleanly
}

// NewMulti creates a poller that watches a specific set of deliberation IDs.
func NewMulti(client *gemot.Client, h *hub.Hub, interval time.Duration, delibIDs []string) *Poller {
	return &Poller{
		client:   client,
		hub:      h,
		interval: interval,
		delibIDs: delibIDs,
		current: &Snapshot{
			Deliberations: make(map[string]*DelibState),
		},
		hashes: make(map[string]string),
	}
}

func (p *Poller) poll(ctx context.Context) {
	var ids []string

	if p.delibID != "" {
		ids = []string{p.delibID}
	} else if len(p.delibIDs) > 0 {
		ids = p.delibIDs
	} else {
		delibs, err := p.client.ListDeliberations()
		if err != nil {
			log.Printf("poller: list deliberations: %v", err)
			return
		}
		for _, d := range delibs {
			ids = append(ids, d.ID)
		}
	}

	newSnapshot := &Snapshot{
		Deliberations: make(map[string]*DelibState),
		FetchedAt:     time.Now(),
	}

	// Each deliberation costs ~5 A2A calls. gemot rate-limits at 30/min.
	// With many deliberations, we may exceed the limit. Fetch sequentially
	// so we get at least the first few updated even if later ones fail.
	for _, id := range ids {
		state, err := p.fetchDelibState(id)
		if err != nil {
			log.Printf("poller: fetch %s: %v", id, err)
			// Keep previous state if fetch fails
			p.mu.RLock()
			if prev, ok := p.current.Deliberations[id]; ok {
				newSnapshot.Deliberations[id] = prev
			}
			p.mu.RUnlock()
			continue
		}
		newSnapshot.Deliberations[id] = state

		// Check if state changed
		hash := hashState(state)
		if old, ok := p.hashes[id]; !ok || old != hash {
			p.hashes[id] = hash
			p.hub.Broadcast("state", state)
		}
	}

	p.mu.Lock()
	p.current = newSnapshot
	p.mu.Unlock()
}

func (p *Poller) fetchDelibState(id string) (*DelibState, error) {
	delib, err := p.client.GetDeliberation(id)
	if err != nil {
		return nil, fmt.Errorf("get deliberation: %w", err)
	}

	positions, err := p.client.GetPositions(id)
	if err != nil {
		return nil, fmt.Errorf("get positions: %w", err)
	}

	votes, err := p.client.GetVotes(id)
	if err != nil {
		return nil, fmt.Errorf("get votes: %w", err)
	}

	analysis, _ := p.client.GetAnalysisResult(id)
	auditLog, _ := p.client.GetAuditLog(id)

	// Derive agent info from positions
	agentMap := make(map[string]*AgentInfo)
	for _, pos := range positions {
		if _, exists := agentMap[pos.AgentID]; !exists {
			agentMap[pos.AgentID] = &AgentInfo{
				ID:          pos.AgentID,
				ModelFamily: pos.ModelFamily,
				Conviction:  pos.Conviction,
			}
		}
	}

	// Enrich with cluster info from analysis
	if analysis != nil {
		for _, cluster := range analysis.Clusters {
			for _, agentID := range cluster.AgentIDs {
				if info, ok := agentMap[agentID]; ok {
					clusterID := cluster.ID
					info.ClusterID = &clusterID
				}
			}
		}
	}

	var agents []AgentInfo
	for _, info := range agentMap {
		agents = append(agents, *info)
	}
	sort.Slice(agents, func(i, j int) bool { return agents[i].ID < agents[j].ID })

	return &DelibState{
		Deliberation: delib,
		Positions:    positions,
		Votes:        votes,
		Analysis:     analysis,
		AuditLog:     auditLog,
		Agents:       agents,
	}, nil
}

func hashState(state *DelibState) string {
	data, _ := json.Marshal(state)
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h[:8])
}
