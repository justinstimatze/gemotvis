package gemot

import "time"

// Mirrored types from gemot's deliberation package.
// Only fields needed for visualization are included.

type Deliberation struct {
	ID          string    `json:"deliberation_id"`
	Topic       string    `json:"topic"`
	Description string    `json:"description"`
	Round       int       `json:"round_number"`
	Status      string    `json:"status"`               // open | analyzing | closed
	SubStatus   string    `json:"sub_status,omitempty"`  // taxonomy | extracting | deduplicating | crux_detection | summarizing | complete
	Type        string    `json:"type,omitempty"`        // reasoning | knowledge | negotiation | policy
	Template    string    `json:"template,omitempty"`    // assembly, jury, consensus, negotiation, review, sortition, parliament
	CreatedAt   time.Time `json:"created_at"`
}

type Position struct {
	ID             string    `json:"position_id"`
	DeliberationID string    `json:"deliberation_id"`
	AgentID        string    `json:"agent_id"`
	Content        string    `json:"content"`
	ModelFamily    string    `json:"model_family,omitempty"`
	Conviction     float64   `json:"conviction,omitempty"`
	Round          int       `json:"round_number"`
	CreatedAt      time.Time `json:"created_at"`
}

type Vote struct {
	ID             string    `json:"vote_id"`
	DeliberationID string    `json:"deliberation_id"`
	AgentID        string    `json:"agent_id"`
	PositionID     string    `json:"position_id"`
	Value          int       `json:"value"` // -1, 0, 1
	CriterionID    string    `json:"criterion_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type Crux struct {
	Claim            string   `json:"crux_claim"`
	Topic            string   `json:"topic"`
	Subtopic         string   `json:"subtopic"`
	AgreeAgents      []string `json:"agree_agents"`
	DisagreeAgents   []string `json:"disagree_agents"`
	NoClearPosition  []string `json:"no_clear_position"`
	ControversyScore float64  `json:"controversy_score"`
	Explanation      string   `json:"explanation"`
	CruxType         string   `json:"crux_type,omitempty"`
	Resolvability    float64  `json:"resolvability,omitempty"`
}

type OpinionCluster struct {
	ID                      int      `json:"cluster_id"`
	AgentIDs                []string `json:"agent_ids"`
	RepresentativePositions []string `json:"representative_positions"`
	Size                    int      `json:"size"`
}

type ConsensusStatement struct {
	PositionID           string  `json:"position_id"`
	Content              string  `json:"content"`
	OverallAgreeRatio    float64 `json:"overall_agree_ratio"`
	MinClusterAgreeRatio float64 `json:"min_cluster_agree_ratio"`
}

type BridgingStatement struct {
	PositionID       string             `json:"position_id"`
	AgentID          string             `json:"agent_id"`
	Content          string             `json:"content"`
	BridgingScore    float64            `json:"bridging_score"`
	OverallAgreeRate float64            `json:"overall_agree_rate"`
	ClusterAgreeRate map[string]float64 `json:"cluster_agree_rate"`
}

type Coalition struct {
	AgentIDs       []string `json:"agent_ids"`
	SharedCruxes   int      `json:"shared_cruxes"`
	StabilityScore float64  `json:"stability_score"`
}

type TopicSummary struct {
	Topic   string `json:"topic"`
	Summary string `json:"summary"`
}

type AuditEntry struct {
	Stage  string `json:"stage"`
	Detail string `json:"detail"`
	Count  int    `json:"count,omitempty"`
}

type AnalysisResult struct {
	DeliberationID       string               `json:"deliberation_id"`
	Round                int                   `json:"round_number"`
	Clusters             []OpinionCluster      `json:"clusters"`
	Cruxes               []Crux                `json:"cruxes"`
	ConsensusStatements  []ConsensusStatement  `json:"consensus_statements"`
	BridgingStatements   []BridgingStatement   `json:"bridging_statements,omitempty"`
	TopicSummaries       []TopicSummary        `json:"topic_summaries"`
	AgentCount           int                   `json:"agent_count"`
	PositionCount        int                   `json:"position_count"`
	VoteCount            int                   `json:"vote_count"`
	Confidence           string                `json:"confidence"`
	Coalitions           []Coalition           `json:"coalitions,omitempty"`
	CompromiseProposal   string                `json:"compromise_proposal,omitempty"`
	TrustWeights         map[string]float64    `json:"trust_weights,omitempty"`
	CorrelationWeights   map[string]float64    `json:"correlation_weights,omitempty"`
	EffectiveWeights     map[string]float64    `json:"effective_weights,omitempty"`
	IntegrityWarnings    []string              `json:"integrity_warnings,omitempty"`
	AuditLog             []AuditEntry          `json:"audit_log,omitempty"`
	ParticipationRate    float64               `json:"participation_rate,omitempty"`
	PerspectiveDiversity float64               `json:"perspective_diversity,omitempty"`
}

// AuditLog wraps the get_audit_log response.
type AuditLog struct {
	Operations        []map[string]string `json:"operations"`
	AnalysisDecisions []AuditEntry        `json:"analysis_decisions"`
}
