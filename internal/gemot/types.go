package gemot

// Type aliases re-exported from the shared types package.
// This eliminates manual type mirroring — the canonical definitions
// live in github.com/justinstimatze/gemot/types.
import "github.com/justinstimatze/gemot/types"

type Deliberation = types.Deliberation
type Position = types.Position
type Vote = types.Vote
type Crux = types.Crux
type OpinionCluster = types.OpinionCluster
type ConsensusStatement = types.ConsensusStatement
type BridgingStatement = types.BridgingStatement
type Coalition = types.Coalition
type TopicSummary = types.TopicSummary
type AuditEntry = types.AuditEntry
type AnalysisResult = types.AnalysisResult
type NullControlResult = types.NullControlResult
type PipelineMetrics = types.PipelineMetrics
type VerificationResult = types.VerificationResult
type VerifyDetail = types.VerifyDetail
type ReplicationResult = types.ReplicationResult
type StabilityReport = types.StabilityReport
type CoverageGap = types.CoverageGap

// AuditLog is gemotvis-specific — wraps the raw export response.
// Not in the shared types package.
type AuditLog struct {
	Operations        []map[string]string `json:"operations"`
	AnalysisDecisions []AuditEntry        `json:"analysis_decisions"`
}
