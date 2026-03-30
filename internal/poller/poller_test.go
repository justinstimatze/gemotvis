package poller

import (
	"sort"
	"testing"
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
)

func TestAgentInfoSortByID(t *testing.T) {
	agents := []AgentInfo{
		{ID: "charlie", ModelFamily: "gpt-4"},
		{ID: "alice", ModelFamily: "claude-3"},
		{ID: "bob", ModelFamily: "gemini"},
	}

	sort.Slice(agents, func(i, j int) bool { return agents[i].ID < agents[j].ID })

	want := []string{"alice", "bob", "charlie"}
	for i, a := range agents {
		if a.ID != want[i] {
			t.Errorf("agents[%d].ID = %q, want %q", i, a.ID, want[i])
		}
	}
}

func TestHashStateDeterministic(t *testing.T) {
	state := &DelibState{
		Deliberation: &gemot.Deliberation{
			ID:    "test-1",
			Topic: "test topic",
			Round: 1,
		},
		Positions: []gemot.Position{
			{ID: "p1", AgentID: "a1", Content: "position one"},
		},
		Votes: []gemot.Vote{
			{ID: "v1", AgentID: "a1", PositionID: "p1", Value: 1},
		},
		Agents: []AgentInfo{
			{ID: "a1", ModelFamily: "claude", Conviction: 0.8},
		},
	}

	h1 := hashState(state)
	h2 := hashState(state)

	if h1 != h2 {
		t.Errorf("hashState not deterministic: %q != %q", h1, h2)
	}

	if len(h1) != 16 { // 8 bytes = 16 hex chars
		t.Errorf("hash length = %d, want 16", len(h1))
	}
}

func TestHashStateDiffersOnChange(t *testing.T) {
	state1 := &DelibState{
		Deliberation: &gemot.Deliberation{ID: "d1", Topic: "topic A"},
		Agents:       []AgentInfo{{ID: "a1"}},
	}
	state2 := &DelibState{
		Deliberation: &gemot.Deliberation{ID: "d1", Topic: "topic B"},
		Agents:       []AgentInfo{{ID: "a1"}},
	}

	h1 := hashState(state1)
	h2 := hashState(state2)

	if h1 == h2 {
		t.Error("hashState should differ for different states")
	}
}

func TestSnapshotStructure(t *testing.T) {
	snap := &Snapshot{
		Deliberations: make(map[string]*DelibState),
		FetchedAt:     time.Now(),
	}

	if snap.Deliberations == nil {
		t.Fatal("Deliberations map is nil")
	}
	if snap.FetchedAt.IsZero() {
		t.Fatal("FetchedAt is zero")
	}

	snap.Deliberations["test"] = &DelibState{
		Deliberation: &gemot.Deliberation{ID: "test"},
	}

	if got := snap.Deliberations["test"].Deliberation.ID; got != "test" {
		t.Errorf("deliberation ID = %q, want %q", got, "test")
	}
}

func TestAgentInfoClusterID(t *testing.T) {
	clusterID := 3
	agent := AgentInfo{
		ID:        "agent-1",
		ClusterID: &clusterID,
	}

	if agent.ClusterID == nil {
		t.Fatal("ClusterID is nil")
	}
	if *agent.ClusterID != 3 {
		t.Errorf("ClusterID = %d, want 3", *agent.ClusterID)
	}
}

func TestAgentInfoOptionalCoordinates(t *testing.T) {
	tests := []struct {
		name string
		x    *float64
		y    *float64
	}{
		{"nil coordinates", nil, nil},
		{"with coordinates", floatPtr(50.0), floatPtr(75.0)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := AgentInfo{
				ID: "a1",
				X:  tt.x,
				Y:  tt.y,
			}
			if (agent.X == nil) != (tt.x == nil) {
				t.Errorf("X nil mismatch")
			}
			if tt.x != nil && *agent.X != *tt.x {
				t.Errorf("X = %f, want %f", *agent.X, *tt.x)
			}
		})
	}
}

func TestDelibStateTypes(t *testing.T) {
	// Verify the JSON tags and structure of DelibState fields.
	state := &DelibState{
		Deliberation: &gemot.Deliberation{
			ID:     "d1",
			Status: "open",
			Round:  2,
		},
		Positions: []gemot.Position{
			{ID: "p1", AgentID: "a1", Round: 1},
			{ID: "p2", AgentID: "a2", Round: 2},
		},
		Votes: []gemot.Vote{
			{ID: "v1", Value: 1},
			{ID: "v2", Value: -1},
		},
		Agents: []AgentInfo{
			{ID: "a1", Conviction: 0.9},
			{ID: "a2", Conviction: 0.5},
		},
	}

	if len(state.Positions) != 2 {
		t.Errorf("positions count = %d, want 2", len(state.Positions))
	}
	if len(state.Votes) != 2 {
		t.Errorf("votes count = %d, want 2", len(state.Votes))
	}
	if state.Analysis != nil {
		t.Error("expected nil Analysis for state without analysis")
	}
}

func floatPtr(v float64) *float64 { return &v }
