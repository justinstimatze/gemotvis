package server

import (
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
	"github.com/justinstimatze/gemotvis/internal/poller"
)

// demoSnapshot returns built-in sample deliberations based on real gemot
// demo scripts and test scenarios. Content is drawn from gemot's own
// scripts/demo/ and scripts/calendar-scheduling/ — real topics and positions
// that have been run through the actual analysis pipeline.
func demoSnapshot() *poller.Snapshot {
	now := time.Now()

	snap := &poller.Snapshot{
		Deliberations: make(map[string]*poller.DelibState),
		FetchedAt:     now,
	}

	// From gemot's landing page demo (scripts/demo/main.go) — 5 expert agents
	snap.Deliberations["ai-governance"] = demoAIGovernance(now)

	// The classic MAGI triangle — 3 of the governance agents
	snap.Deliberations["magi-triangle"] = demoMAGITriangle(now)

	// From gemot's calendar scheduling demo (scripts/calendar-scheduling/main.go)
	snap.Deliberations["calendar-sync"] = demoCalendarScheduling(now)

	// Analyzing state — shows the pipeline progress bar
	snap.Deliberations["analyzing"] = demoAnalyzing(now)

	return snap
}

// demoAIGovernance reproduces the 5-agent AI governance deliberation from
// gemot's landing page demo. These are the actual positions, vote matrix,
// and representative analysis output from real runs.
func demoAIGovernance(now time.Time) *poller.DelibState {
	return &poller.DelibState{
		Deliberation: &gemot.Deliberation{
			ID:          "ai-governance",
			Topic:       "How should we govern frontier AI development?",
			Description: "Five experts with different perspectives deliberate on AI governance. Each submits a position, votes on others' positions, then receives analysis identifying the key disagreements and areas of consensus.",
			Round:       1,
			Status:      "open",
			Type:        "policy",
			Template:    "assembly",
			CreatedAt:   now.Add(-30 * time.Minute),
		},
		Agents: []poller.AgentInfo{
			{ID: "safety-researcher", ModelFamily: "claude", Conviction: 0.9, ClusterID: intPtr(0)},
			{ID: "startup-founder", ModelFamily: "gpt", Conviction: 0.85, ClusterID: intPtr(1)},
			{ID: "ethicist", ModelFamily: "claude", Conviction: 0.8, ClusterID: intPtr(0)},
			{ID: "policy-advisor", ModelFamily: "gemini", Conviction: 0.7, ClusterID: intPtr(2)},
			{ID: "open-source-dev", ModelFamily: "gpt", Conviction: 0.85, ClusterID: intPtr(1)},
		},
		Positions: []gemot.Position{
			{ID: "p1", DeliberationID: "ai-governance", AgentID: "safety-researcher",
				Content:     "We need mandatory third-party safety evaluations before any frontier model is deployed. The current voluntary commitment framework has failed — labs routinely break their own promises. An international evaluation body with binding authority, similar to how the FDA approves drugs, is the minimum viable governance structure.",
				ModelFamily: "claude", Conviction: 0.9, Round: 1, CreatedAt: now.Add(-28 * time.Minute)},
			{ID: "p2", DeliberationID: "ai-governance", AgentID: "startup-founder",
				Content:     "Heavy-handed regulation will kill innovation and hand the AI race to China. The best safety mechanism is competition — companies that ship unsafe products lose customers and face lawsuits. We need regulatory sandboxes and safe harbors, not blanket restrictions that entrench incumbents.",
				ModelFamily: "gpt", Conviction: 0.85, Round: 1, CreatedAt: now.Add(-26 * time.Minute)},
			{ID: "p3", DeliberationID: "ai-governance", AgentID: "ethicist",
				Content:     "The debate is wrongly framed as safety versus innovation. The real question is: who bears the costs of AI failures? Right now it's the most vulnerable populations. We need algorithmic impact assessments, mandatory bias auditing, and affected community representation in governance bodies.",
				ModelFamily: "claude", Conviction: 0.8, Round: 1, CreatedAt: now.Add(-24 * time.Minute)},
			{ID: "p4", DeliberationID: "ai-governance", AgentID: "policy-advisor",
				Content:     "Effective AI governance requires adaptive regulation — hard rules will be obsolete before implementation. We should focus on mandatory incident reporting, regulatory sandboxes for controlled experimentation, and international coordination through existing bodies like the OECD rather than creating new institutions.",
				ModelFamily: "gemini", Conviction: 0.7, Round: 1, CreatedAt: now.Add(-22 * time.Minute)},
			{ID: "p5", DeliberationID: "ai-governance", AgentID: "open-source-dev",
				Content:     "Open-weight models are the most important safety mechanism we have. Closed development concentrates power without accountability. Export controls on chips are a better lever than restricting model distribution. The real risk isn't open models — it's a permanent asymmetry where three companies control humanity's most powerful technology.",
				ModelFamily: "gpt", Conviction: 0.85, Round: 1, CreatedAt: now.Add(-20 * time.Minute)},
		},
		// Real vote matrix from gemot demo script
		Votes: []gemot.Vote{
			{ID: "v01", DeliberationID: "ai-governance", AgentID: "safety-researcher", PositionID: "p2", Value: -1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "v02", DeliberationID: "ai-governance", AgentID: "safety-researcher", PositionID: "p3", Value: 1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "v03", DeliberationID: "ai-governance", AgentID: "safety-researcher", PositionID: "p4", Value: 0, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "v04", DeliberationID: "ai-governance", AgentID: "safety-researcher", PositionID: "p5", Value: -1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "v05", DeliberationID: "ai-governance", AgentID: "startup-founder", PositionID: "p1", Value: -1, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "v06", DeliberationID: "ai-governance", AgentID: "startup-founder", PositionID: "p3", Value: 0, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "v07", DeliberationID: "ai-governance", AgentID: "startup-founder", PositionID: "p4", Value: 1, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "v08", DeliberationID: "ai-governance", AgentID: "startup-founder", PositionID: "p5", Value: 1, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "v09", DeliberationID: "ai-governance", AgentID: "ethicist", PositionID: "p1", Value: 1, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "v10", DeliberationID: "ai-governance", AgentID: "ethicist", PositionID: "p2", Value: -1, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "v11", DeliberationID: "ai-governance", AgentID: "ethicist", PositionID: "p4", Value: 0, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "v12", DeliberationID: "ai-governance", AgentID: "ethicist", PositionID: "p5", Value: 0, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "v13", DeliberationID: "ai-governance", AgentID: "policy-advisor", PositionID: "p1", Value: 0, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "v14", DeliberationID: "ai-governance", AgentID: "policy-advisor", PositionID: "p2", Value: 0, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "v15", DeliberationID: "ai-governance", AgentID: "policy-advisor", PositionID: "p3", Value: 1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "v16", DeliberationID: "ai-governance", AgentID: "policy-advisor", PositionID: "p5", Value: 0, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "v17", DeliberationID: "ai-governance", AgentID: "open-source-dev", PositionID: "p1", Value: -1, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "v18", DeliberationID: "ai-governance", AgentID: "open-source-dev", PositionID: "p2", Value: 1, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "v19", DeliberationID: "ai-governance", AgentID: "open-source-dev", PositionID: "p3", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "v20", DeliberationID: "ai-governance", AgentID: "open-source-dev", PositionID: "p4", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
		},
		Analysis: &gemot.AnalysisResult{
			DeliberationID: "ai-governance", Round: 1,
			Clusters: []gemot.OpinionCluster{
				{ID: 0, AgentIDs: []string{"safety-researcher", "ethicist"}, Size: 2},
				{ID: 1, AgentIDs: []string{"startup-founder", "open-source-dev"}, Size: 2},
				{ID: 2, AgentIDs: []string{"policy-advisor"}, Size: 1},
			},
			Cruxes: []gemot.Crux{
				{
					Claim:            "Governments, not industry, should be the primary regulators of AI development",
					Topic:            "Regulation approach",
					Subtopic:         "Government vs self-regulation",
					AgreeAgents:      []string{"safety-researcher", "ethicist"},
					DisagreeAgents:   []string{"startup-founder", "open-source-dev"},
					NoClearPosition:  []string{"policy-advisor"},
					ControversyScore: 0.87,
					CruxType:         "value",
					Explanation:      "The safety/ethics cluster believes government authority is essential to prevent a race to the bottom, while the innovation cluster argues that technical complexity makes industry self-regulation more effective.",
					Resolvability:    0.3,
				},
				{
					Claim:            "Open-weight models improve safety by enabling independent research and accountability",
					Topic:            "Openness vs control",
					AgreeAgents:      []string{"open-source-dev", "startup-founder"},
					DisagreeAgents:   []string{"safety-researcher"},
					NoClearPosition:  []string{"ethicist", "policy-advisor"},
					ControversyScore: 0.72,
					CruxType:         "factual",
					Explanation:      "Disagreement on whether open models enable better safety research or simply distribute dangerous capabilities more widely.",
					Resolvability:    0.5,
				},
				{
					Claim:            "Existing institutions like the OECD can effectively coordinate AI governance",
					Topic:            "Institutional design",
					AgreeAgents:      []string{"policy-advisor", "startup-founder"},
					DisagreeAgents:   []string{"safety-researcher", "ethicist"},
					ControversyScore: 0.58,
					CruxType:         "factual",
					Resolvability:    0.6,
				},
			},
			ConsensusStatements: []gemot.ConsensusStatement{
				{PositionID: "p4", Content: "Some form of mandatory incident reporting for AI failures is needed", OverallAgreeRatio: 0.78, MinClusterAgreeRatio: 0.65},
			},
			BridgingStatements: []gemot.BridgingStatement{
				{PositionID: "p4", AgentID: "policy-advisor", Content: "Adaptive regulation with mandatory incident reporting and regulatory sandboxes", BridgingScore: 0.65, OverallAgreeRate: 0.60, ClusterAgreeRate: map[string]float64{"0": 0.50, "1": 0.60, "2": 1.0}},
			},
			AgentCount: 5, PositionCount: 5, VoteCount: 20, Confidence: "medium",
			TrustWeights:         map[string]float64{"safety-researcher": 1.0, "startup-founder": 0.95, "ethicist": 0.9, "policy-advisor": 0.85, "open-source-dev": 0.95},
			IntegrityWarnings:    []string{"MODEL_DIVERSITY: 2 of 5 agents share claude model family"},
			ParticipationRate:    0.80,
			PerspectiveDiversity: 0.60,
		},
		AuditLog: &gemot.AuditLog{
			Operations: []map[string]string{
				{"timestamp": now.Add(-28 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-26 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-24 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "ethicist"},
				{"timestamp": now.Add(-22 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-20 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "open-source-dev"},
				{"timestamp": now.Add(-18 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-16 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-14 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "ethicist"},
				{"timestamp": now.Add(-12 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-10 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "open-source-dev"},
				{"timestamp": now.Add(-8 * time.Minute).Format(time.RFC3339), "method": "gemot/analyze", "agent_id": ""},
			},
		},
	}
}

// demoMAGITriangle takes 3 of the AI governance agents for the classic MAGI layout.
func demoMAGITriangle(now time.Time) *poller.DelibState {
	return &poller.DelibState{
		Deliberation: &gemot.Deliberation{
			ID:          "magi-triangle",
			Topic:       "Should frontier AI development require government approval?",
			Description: "Three perspectives deliberate: safety demands binding oversight, industry warns of stifled innovation, and a bridge position seeks adaptive middle ground.",
			Round:       1,
			Status:      "open",
			Type:        "reasoning",
			Template:    "jury",
			CreatedAt:   now.Add(-20 * time.Minute),
		},
		Agents: []poller.AgentInfo{
			{ID: "safety-researcher", ModelFamily: "claude", Conviction: 0.9, ClusterID: intPtr(0)},
			{ID: "startup-founder", ModelFamily: "gpt", Conviction: 0.85, ClusterID: intPtr(1)},
			{ID: "policy-advisor", ModelFamily: "gemini", Conviction: 0.7, ClusterID: intPtr(1)},
		},
		Positions: []gemot.Position{
			{ID: "mt1", DeliberationID: "magi-triangle", AgentID: "safety-researcher",
				Content:     "We need mandatory third-party safety evaluations before any frontier model is deployed. The current voluntary commitment framework has failed — labs routinely break their own promises.",
				ModelFamily: "claude", Conviction: 0.9, Round: 1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "mt2", DeliberationID: "magi-triangle", AgentID: "startup-founder",
				Content:     "Heavy-handed regulation will kill innovation and hand the AI race to China. The best safety mechanism is competition — companies that ship unsafe products lose customers and face lawsuits.",
				ModelFamily: "gpt", Conviction: 0.85, Round: 1, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "mt3", DeliberationID: "magi-triangle", AgentID: "policy-advisor",
				Content:     "Effective AI governance requires adaptive regulation — hard rules will be obsolete before implementation. Focus on mandatory incident reporting and international coordination through existing bodies.",
				ModelFamily: "gemini", Conviction: 0.7, Round: 1, CreatedAt: now.Add(-14 * time.Minute)},
		},
		Votes: []gemot.Vote{
			{ID: "mv1", DeliberationID: "magi-triangle", AgentID: "safety-researcher", PositionID: "mt2", Value: -1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "mv2", DeliberationID: "magi-triangle", AgentID: "safety-researcher", PositionID: "mt3", Value: 0, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "mv3", DeliberationID: "magi-triangle", AgentID: "startup-founder", PositionID: "mt1", Value: -1, CreatedAt: now.Add(-11 * time.Minute)},
			{ID: "mv4", DeliberationID: "magi-triangle", AgentID: "startup-founder", PositionID: "mt3", Value: 1, CreatedAt: now.Add(-11 * time.Minute)},
			{ID: "mv5", DeliberationID: "magi-triangle", AgentID: "policy-advisor", PositionID: "mt1", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "mv6", DeliberationID: "magi-triangle", AgentID: "policy-advisor", PositionID: "mt2", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
		},
		Analysis: &gemot.AnalysisResult{
			DeliberationID: "magi-triangle", Round: 1,
			Clusters: []gemot.OpinionCluster{
				{ID: 0, AgentIDs: []string{"safety-researcher"}, Size: 1},
				{ID: 1, AgentIDs: []string{"startup-founder", "policy-advisor"}, Size: 2},
			},
			Cruxes: []gemot.Crux{
				{Claim: "Mandatory government pre-approval is needed before deploying frontier models", Topic: "Regulatory authority", AgreeAgents: []string{"safety-researcher"}, DisagreeAgents: []string{"startup-founder"}, NoClearPosition: []string{"policy-advisor"}, ControversyScore: 0.85, CruxType: "value"},
				{Claim: "Market incentives alone are sufficient to ensure AI safety", Topic: "Safety mechanisms", AgreeAgents: []string{"startup-founder"}, DisagreeAgents: []string{"safety-researcher"}, ControversyScore: 0.78, CruxType: "factual"},
			},
			ConsensusStatements: []gemot.ConsensusStatement{
				{PositionID: "mt3", Content: "Mandatory incident reporting for AI failures", OverallAgreeRatio: 0.83, MinClusterAgreeRatio: 0.75},
			},
			BridgingStatements: []gemot.BridgingStatement{
				{PositionID: "mt3", AgentID: "policy-advisor", Content: "Adaptive regulation with mandatory incident reporting", BridgingScore: 0.70, OverallAgreeRate: 0.67, ClusterAgreeRate: map[string]float64{"0": 0.5, "1": 0.75}},
			},
			AgentCount: 3, PositionCount: 3, VoteCount: 6, Confidence: "medium",
			TrustWeights:         map[string]float64{"safety-researcher": 1.0, "startup-founder": 0.95, "policy-advisor": 0.85},
			ParticipationRate:    1.0,
			PerspectiveDiversity: 0.67,
		},
		AuditLog: &gemot.AuditLog{
			Operations: []map[string]string{
				{"timestamp": now.Add(-18 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-16 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-14 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-12 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-11 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-10 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-8 * time.Minute).Format(time.RFC3339), "method": "gemot/analyze", "agent_id": ""},
			},
		},
	}
}

// demoCalendarScheduling reproduces gemot's calendar scheduling demo
// (scripts/calendar-scheduling/main.go) — 5 agents negotiating a meeting time.
func demoCalendarScheduling(now time.Time) *poller.DelibState {
	return &poller.DelibState{
		Deliberation: &gemot.Deliberation{
			ID:          "calendar-sync",
			Topic:       "Schedule 1-hour team sync this week",
			Description: "Five team members negotiate a meeting time by sharing availability windows — not calendar details. Each proposes preferred slots with conviction scores and declares hard constraints as reservations.",
			Round:       1,
			Status:      "open",
			Type:        "negotiation",
			Template:    "negotiation",
			CreatedAt:   now.Add(-25 * time.Minute),
		},
		Agents: []poller.AgentInfo{
			{ID: "alice-agent", ModelFamily: "claude", Conviction: 0.7, ClusterID: intPtr(0)},
			{ID: "bob-agent", ModelFamily: "gpt", Conviction: 0.6, ClusterID: intPtr(1)},
			{ID: "carol-agent", ModelFamily: "gemini", Conviction: 0.5, ClusterID: intPtr(0)},
			{ID: "dave-agent", ModelFamily: "claude", Conviction: 0.8, ClusterID: intPtr(1)},
			{ID: "eve-agent", ModelFamily: "gpt", Conviction: 0.6, ClusterID: intPtr(0)},
		},
		Positions: []gemot.Position{
			{ID: "cp1", DeliberationID: "calendar-sync", AgentID: "alice-agent",
				Content:     "PREFERRED (morning): Mon 9-11 AM, Wed 9-10 AM, Fri 10-12 PM. ACCEPTABLE (afternoon): Tue 2-4 PM, Fri 1-3 PM. I strongly prefer mornings — I'm most focused before lunch.",
				ModelFamily: "claude", Conviction: 0.7, Round: 1, CreatedAt: now.Add(-22 * time.Minute)},
			{ID: "cp2", DeliberationID: "calendar-sync", AgentID: "bob-agent",
				Content:     "PREFERRED (afternoon): Mon 2-5 PM, Thu 1-4 PM, Fri 2-4 PM. ACCEPTABLE (morning): Tue 10-11 AM, Fri 9-11 AM. I work best in the afternoon after getting through morning tasks. Wednesday is completely blocked — all-day offsite.",
				ModelFamily: "gpt", Conviction: 0.6, Round: 1, CreatedAt: now.Add(-20 * time.Minute)},
			{ID: "cp3", DeliberationID: "calendar-sync", AgentID: "carol-agent",
				Content:     "PREFERRED: Tue 10 AM-2 PM, Thu 10 AM-2 PM. ACCEPTABLE: Mon/Wed/Fri 9 AM-2 PM. I'm flexible on the day but I need to leave by 3 PM for school pickup, so the meeting must end by 2:00 PM at the latest.",
				ModelFamily: "gemini", Conviction: 0.5, Round: 1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "cp4", DeliberationID: "calendar-sync", AgentID: "dave-agent",
				Content:     "PREFERRED: Mon 11 AM-3 PM, Fri 11 AM-3 PM. ACCEPTABLE: Wed 11 AM-3 PM. I'm in a later timezone so I can't start before 11 AM. I only work Mon/Wed/Fri — Tue/Thu are blocked for a client engagement.",
				ModelFamily: "claude", Conviction: 0.8, Round: 1, CreatedAt: now.Add(-16 * time.Minute)},
			{ID: "cp5", DeliberationID: "calendar-sync", AgentID: "eve-agent",
				Content:     "PREFERRED: Mon 10 AM-12 PM, Tue 10 AM-12 PM. ACCEPTABLE: Wed 1-3 PM. I'm part-time and only work Monday through Wednesday. Strong preference for late morning.",
				ModelFamily: "gpt", Conviction: 0.6, Round: 1, CreatedAt: now.Add(-14 * time.Minute)},
		},
		Votes: []gemot.Vote{
			// Morning people (Alice, Eve) agree; afternoon people (Bob, Dave) agree; Carol is flexible
			{ID: "cv1", DeliberationID: "calendar-sync", AgentID: "alice-agent", PositionID: "cp5", Value: 1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "cv2", DeliberationID: "calendar-sync", AgentID: "alice-agent", PositionID: "cp2", Value: -1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "cv3", DeliberationID: "calendar-sync", AgentID: "bob-agent", PositionID: "cp4", Value: 1, CreatedAt: now.Add(-11 * time.Minute)},
			{ID: "cv4", DeliberationID: "calendar-sync", AgentID: "bob-agent", PositionID: "cp1", Value: -1, CreatedAt: now.Add(-11 * time.Minute)},
			{ID: "cv5", DeliberationID: "calendar-sync", AgentID: "carol-agent", PositionID: "cp1", Value: 1, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "cv6", DeliberationID: "calendar-sync", AgentID: "carol-agent", PositionID: "cp4", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "cv7", DeliberationID: "calendar-sync", AgentID: "dave-agent", PositionID: "cp2", Value: 1, CreatedAt: now.Add(-9 * time.Minute)},
			{ID: "cv8", DeliberationID: "calendar-sync", AgentID: "dave-agent", PositionID: "cp1", Value: -1, CreatedAt: now.Add(-9 * time.Minute)},
			{ID: "cv9", DeliberationID: "calendar-sync", AgentID: "eve-agent", PositionID: "cp1", Value: 1, CreatedAt: now.Add(-8 * time.Minute)},
			{ID: "cv10", DeliberationID: "calendar-sync", AgentID: "eve-agent", PositionID: "cp2", Value: -1, CreatedAt: now.Add(-8 * time.Minute)},
		},
		Analysis: &gemot.AnalysisResult{
			DeliberationID: "calendar-sync", Round: 1,
			Clusters: []gemot.OpinionCluster{
				{ID: 0, AgentIDs: []string{"alice-agent", "carol-agent", "eve-agent"}, Size: 3},
				{ID: 1, AgentIDs: []string{"bob-agent", "dave-agent"}, Size: 2},
			},
			Cruxes: []gemot.Crux{
				{Claim: "The meeting should be in the morning (before noon)", Topic: "Time preference", AgreeAgents: []string{"alice-agent", "eve-agent"}, DisagreeAgents: []string{"bob-agent", "dave-agent"}, NoClearPosition: []string{"carol-agent"}, ControversyScore: 0.75, CruxType: "factual", Resolvability: 0.9},
				{Claim: "Monday is the best day for the team sync", Topic: "Day preference", AgreeAgents: []string{"alice-agent", "dave-agent", "eve-agent"}, DisagreeAgents: []string{}, NoClearPosition: []string{"bob-agent", "carol-agent"}, ControversyScore: 0.35, CruxType: "factual", Resolvability: 0.95},
			},
			CompromiseProposal:   "Monday 11:00 AM - 12:00 PM. This is the only slot where all five members overlap: Alice and Eve prefer mornings, Dave can start at 11 AM, Carol ends by 2 PM, and Bob has an acceptable morning window on Monday.",
			AgentCount:           5, PositionCount: 5, VoteCount: 10, Confidence: "high",
			TrustWeights:         map[string]float64{"alice-agent": 1.0, "bob-agent": 1.0, "carol-agent": 1.0, "dave-agent": 1.0, "eve-agent": 1.0},
			ParticipationRate:    0.40,
			PerspectiveDiversity: 0.40,
		},
		AuditLog: &gemot.AuditLog{
			Operations: []map[string]string{
				{"timestamp": now.Add(-22 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "alice-agent"},
				{"timestamp": now.Add(-20 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "bob-agent"},
				{"timestamp": now.Add(-18 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "carol-agent"},
				{"timestamp": now.Add(-16 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "dave-agent"},
				{"timestamp": now.Add(-14 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "eve-agent"},
				{"timestamp": now.Add(-12 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "alice-agent"},
				{"timestamp": now.Add(-11 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "bob-agent"},
				{"timestamp": now.Add(-10 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "carol-agent"},
				{"timestamp": now.Add(-9 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "dave-agent"},
				{"timestamp": now.Add(-8 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "eve-agent"},
				{"timestamp": now.Add(-6 * time.Minute).Format(time.RFC3339), "method": "gemot/analyze", "agent_id": ""},
			},
		},
	}
}

// demoAnalyzing shows a deliberation mid-analysis to demonstrate the pipeline progress bar.
func demoAnalyzing(now time.Time) *poller.DelibState {
	return &poller.DelibState{
		Deliberation: &gemot.Deliberation{
			ID:          "analyzing",
			Topic:       "How should we govern frontier AI development?",
			Description: "The same governance deliberation, but caught mid-analysis. Watch the pipeline stages progress.",
			Round:       2,
			Status:      "analyzing",
			SubStatus:   "crux_detection",
			Type:        "policy",
			Template:    "assembly",
			CreatedAt:   now.Add(-45 * time.Minute),
		},
		Agents: []poller.AgentInfo{
			{ID: "safety-researcher", ModelFamily: "claude", Conviction: 0.9, ClusterID: intPtr(0)},
			{ID: "startup-founder", ModelFamily: "gpt", Conviction: 0.85, ClusterID: intPtr(1)},
			{ID: "ethicist", ModelFamily: "claude", Conviction: 0.8, ClusterID: intPtr(0)},
			{ID: "policy-advisor", ModelFamily: "gemini", Conviction: 0.7, ClusterID: intPtr(2)},
		},
		Positions: []gemot.Position{
			{ID: "ap1", DeliberationID: "analyzing", AgentID: "safety-researcher",
				Content: "After seeing the crux analysis, I maintain that mandatory pre-deployment evaluation is essential. The policy-advisor's incident reporting proposal is a floor, not a ceiling.",
				ModelFamily: "claude", Conviction: 0.9, Round: 2, CreatedAt: now.Add(-35 * time.Minute)},
			{ID: "ap2", DeliberationID: "analyzing", AgentID: "startup-founder",
				Content: "Round 1 confirmed that adaptive regulation is the path forward. I can accept mandatory incident reporting if it comes with safe harbor provisions for companies that report transparently.",
				ModelFamily: "gpt", Conviction: 0.75, Round: 2, CreatedAt: now.Add(-33 * time.Minute)},
			{ID: "ap3", DeliberationID: "analyzing", AgentID: "ethicist",
				Content: "The bridging analysis shows incident reporting has broad support. I'd strengthen it: reporting should include affected community impact assessments, not just technical failure modes.",
				ModelFamily: "claude", Conviction: 0.8, Round: 2, CreatedAt: now.Add(-31 * time.Minute)},
			{ID: "ap4", DeliberationID: "analyzing", AgentID: "policy-advisor",
				Content: "The convergence on incident reporting validates the adaptive approach. Proposing a concrete framework: mandatory reporting within 72 hours, public database, annual review of thresholds.",
				ModelFamily: "gemini", Conviction: 0.8, Round: 2, CreatedAt: now.Add(-29 * time.Minute)},
		},
		Votes: []gemot.Vote{
			{ID: "av1", DeliberationID: "analyzing", AgentID: "safety-researcher", PositionID: "ap4", Value: 1, CreatedAt: now.Add(-25 * time.Minute)},
			{ID: "av2", DeliberationID: "analyzing", AgentID: "startup-founder", PositionID: "ap4", Value: 1, CreatedAt: now.Add(-24 * time.Minute)},
			{ID: "av3", DeliberationID: "analyzing", AgentID: "ethicist", PositionID: "ap4", Value: 0, CreatedAt: now.Add(-23 * time.Minute)},
			{ID: "av4", DeliberationID: "analyzing", AgentID: "policy-advisor", PositionID: "ap1", Value: 0, CreatedAt: now.Add(-22 * time.Minute)},
			{ID: "av5", DeliberationID: "analyzing", AgentID: "safety-researcher", PositionID: "ap2", Value: 0, CreatedAt: now.Add(-25 * time.Minute)},
			{ID: "av6", DeliberationID: "analyzing", AgentID: "startup-founder", PositionID: "ap1", Value: -1, CreatedAt: now.Add(-24 * time.Minute)},
		},
		Analysis: nil, // Still analyzing
		AuditLog: &gemot.AuditLog{
			Operations: []map[string]string{
				{"timestamp": now.Add(-35 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-33 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-31 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "ethicist"},
				{"timestamp": now.Add(-29 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-25 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "safety-researcher"},
				{"timestamp": now.Add(-24 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "startup-founder"},
				{"timestamp": now.Add(-23 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "ethicist"},
				{"timestamp": now.Add(-22 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "policy-advisor"},
				{"timestamp": now.Add(-20 * time.Minute).Format(time.RFC3339), "method": "gemot/analyze", "agent_id": ""},
			},
		},
	}
}

// demoDiplomacy creates a 7-power diplomacy scenario with geographic positioning.
// Inspired by gemot's scripts/diplomacy/ which analyzes AI Diplomacy game messages.
func demoDiplomacy(now time.Time) *poller.DelibState {
	// Rough European map positions (x=0-100 left-right, y=0-100 top-bottom)
	f := func(v float64) *float64 { return &v }

	agents := []poller.AgentInfo{
		{ID: "england", ModelFamily: "claude", Conviction: 0.8, ClusterID: intPtr(0), X: f(25), Y: f(22)},
		{ID: "france", ModelFamily: "gpt", Conviction: 0.75, ClusterID: intPtr(0), X: f(30), Y: f(48)},
		{ID: "germany", ModelFamily: "gemini", Conviction: 0.85, ClusterID: intPtr(1), X: f(48), Y: f(30)},
		{ID: "italy", ModelFamily: "claude", Conviction: 0.7, ClusterID: intPtr(2), X: f(48), Y: f(60)},
		{ID: "austria", ModelFamily: "gpt", Conviction: 0.8, ClusterID: intPtr(1), X: f(55), Y: f(45)},
		{ID: "russia", ModelFamily: "gemini", Conviction: 0.9, ClusterID: intPtr(2), X: f(78), Y: f(25)},
		{ID: "turkey", ModelFamily: "claude", Conviction: 0.75, ClusterID: intPtr(2), X: f(75), Y: f(62)},
	}

	return &poller.DelibState{
		Deliberation: &gemot.Deliberation{
			ID:          "diplomacy",
			Topic:       "Spring 1901 diplomatic negotiations",
			Description: "Seven AI powers negotiate alliances and strategy in a Diplomacy game. Each power's agent analyzes messages and proposes moves.",
			Round:       1,
			Status:      "open",
			Type:        "negotiation",
			Template:    "assembly",
			CreatedAt:   now.Add(-30 * time.Minute),
		},
		Agents: agents,
		Positions: []gemot.Position{
			{ID: "dp1", DeliberationID: "diplomacy", AgentID: "england", Content: "Proposing Channel alliance with France against Germany. Our naval superiority in the North Sea must be leveraged early. Requesting French support into Belgium.", ModelFamily: "claude", Conviction: 0.8, Round: 1, CreatedAt: now.Add(-28 * time.Minute)},
			{ID: "dp2", DeliberationID: "diplomacy", AgentID: "france", Content: "Open to English alliance but need assurance on Iberian neutrality. Proposing joint action in the Low Countries while I secure the Mediterranean flank.", ModelFamily: "gpt", Conviction: 0.75, Round: 1, CreatedAt: now.Add(-26 * time.Minute)},
			{ID: "dp3", DeliberationID: "diplomacy", AgentID: "germany", Content: "Proposing Austro-German alliance against Russia. Offering Scandinavia in exchange for Austrian support in the east. France is the long-term threat.", ModelFamily: "gemini", Conviction: 0.85, Round: 1, CreatedAt: now.Add(-24 * time.Minute)},
			{ID: "dp4", DeliberationID: "diplomacy", AgentID: "italy", Content: "Maintaining neutrality while securing the Mediterranean. Proposing Lepanto opening with Austrian cooperation to contain Turkey.", ModelFamily: "claude", Conviction: 0.7, Round: 1, CreatedAt: now.Add(-22 * time.Minute)},
			{ID: "dp5", DeliberationID: "diplomacy", AgentID: "austria", Content: "Accepting German alliance proposal. Prioritizing Balkan expansion while keeping Italy neutral. Turkey is the immediate threat.", ModelFamily: "gpt", Conviction: 0.8, Round: 1, CreatedAt: now.Add(-20 * time.Minute)},
			{ID: "dp6", DeliberationID: "diplomacy", AgentID: "russia", Content: "Proposing northern strategy: secure Scandinavia and pressure Germany. Open to temporary truce with Turkey in the Black Sea.", ModelFamily: "gemini", Conviction: 0.9, Round: 1, CreatedAt: now.Add(-18 * time.Minute)},
			{ID: "dp7", DeliberationID: "diplomacy", AgentID: "turkey", Content: "Proposing Juggernaut with Russia against Austria. Black Sea should be demilitarized. Italy must be kept out of the eastern Mediterranean.", ModelFamily: "claude", Conviction: 0.75, Round: 1, CreatedAt: now.Add(-16 * time.Minute)},
		},
		Votes: []gemot.Vote{
			// Western alliance (England-France agree)
			{ID: "dv1", DeliberationID: "diplomacy", AgentID: "england", PositionID: "dp2", Value: 1, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "dv2", DeliberationID: "diplomacy", AgentID: "france", PositionID: "dp1", Value: 1, CreatedAt: now.Add(-13 * time.Minute)},
			// Central powers (Germany-Austria agree)
			{ID: "dv3", DeliberationID: "diplomacy", AgentID: "germany", PositionID: "dp5", Value: 1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "dv4", DeliberationID: "diplomacy", AgentID: "austria", PositionID: "dp3", Value: 1, CreatedAt: now.Add(-11 * time.Minute)},
			// Eastern bloc (Russia-Turkey tentative)
			{ID: "dv5", DeliberationID: "diplomacy", AgentID: "russia", PositionID: "dp7", Value: 0, CreatedAt: now.Add(-10 * time.Minute)},
			{ID: "dv6", DeliberationID: "diplomacy", AgentID: "turkey", PositionID: "dp6", Value: 0, CreatedAt: now.Add(-9 * time.Minute)},
			// Cross-alliance disagreements
			{ID: "dv7", DeliberationID: "diplomacy", AgentID: "england", PositionID: "dp3", Value: -1, CreatedAt: now.Add(-14 * time.Minute)},
			{ID: "dv8", DeliberationID: "diplomacy", AgentID: "germany", PositionID: "dp1", Value: -1, CreatedAt: now.Add(-12 * time.Minute)},
			{ID: "dv9", DeliberationID: "diplomacy", AgentID: "austria", PositionID: "dp7", Value: -1, CreatedAt: now.Add(-11 * time.Minute)},
			{ID: "dv10", DeliberationID: "diplomacy", AgentID: "italy", PositionID: "dp4", Value: 1, CreatedAt: now.Add(-10 * time.Minute)},
		},
		Analysis: &gemot.AnalysisResult{
			DeliberationID: "diplomacy", Round: 1,
			Clusters: []gemot.OpinionCluster{
				{ID: 0, AgentIDs: []string{"england", "france"}, Size: 2},
				{ID: 1, AgentIDs: []string{"germany", "austria"}, Size: 2},
				{ID: 2, AgentIDs: []string{"russia", "turkey", "italy"}, Size: 3},
			},
			Cruxes: []gemot.Crux{
				{Claim: "Germany is the primary threat requiring immediate containment", Topic: "Alliance strategy", AgreeAgents: []string{"england", "france"}, DisagreeAgents: []string{"germany", "austria"}, NoClearPosition: []string{"italy"}, ControversyScore: 0.82, CruxType: "value"},
				{Claim: "The Black Sea should be demilitarized in Spring 1901", Topic: "Eastern front", AgreeAgents: []string{"turkey"}, DisagreeAgents: []string{"russia"}, NoClearPosition: []string{"austria"}, ControversyScore: 0.65, CruxType: "factual"},
				{Claim: "Italy should remain neutral in the first year", Topic: "Italian strategy", AgreeAgents: []string{"italy", "austria"}, DisagreeAgents: []string{"france", "turkey"}, ControversyScore: 0.55, CruxType: "value"},
			},
			AgentCount: 7, PositionCount: 7, VoteCount: 10, Confidence: "medium",
			TrustWeights:         map[string]float64{"england": 0.9, "france": 0.85, "germany": 0.95, "italy": 0.8, "austria": 0.9, "russia": 0.95, "turkey": 0.85},
			ParticipationRate:    0.20,
			PerspectiveDiversity: 0.43,
		},
		AuditLog: &gemot.AuditLog{
			Operations: []map[string]string{
				{"timestamp": now.Add(-28 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "england"},
				{"timestamp": now.Add(-26 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "france"},
				{"timestamp": now.Add(-24 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "germany"},
				{"timestamp": now.Add(-22 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "italy"},
				{"timestamp": now.Add(-20 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "austria"},
				{"timestamp": now.Add(-18 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "russia"},
				{"timestamp": now.Add(-16 * time.Minute).Format(time.RFC3339), "method": "gemot/submit_position", "agent_id": "turkey"},
				{"timestamp": now.Add(-14 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "england"},
				{"timestamp": now.Add(-12 * time.Minute).Format(time.RFC3339), "method": "gemot/vote", "agent_id": "germany"},
			},
		},
	}
}

func intPtr(i int) *int {
	return &i
}

