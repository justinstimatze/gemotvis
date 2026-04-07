// Mirrors Go types from internal/gemot/types.go and internal/poller/poller.go

export interface Deliberation {
  deliberation_id: string;
  topic: string;
  description: string;
  round_number: number;
  status: 'open' | 'analyzing' | 'closed';
  sub_status?: string; // taxonomy | extracting | deduplicating | crux_detection | summarizing | complete
  type?: string;       // reasoning | knowledge | negotiation | policy
  template?: string;   // assembly, jury, consensus, negotiation, review, sortition, parliament
  created_at: string;
}

export interface Position {
  position_id: string;
  deliberation_id: string;
  agent_id: string;
  content: string;
  model_family?: string;
  conviction?: number;
  metadata?: Record<string, unknown>;
  round_number: number;
  created_at: string;
}

export interface Vote {
  vote_id: string;
  deliberation_id: string;
  agent_id: string;
  position_id: string;
  value: -1 | 0 | 1;
  criterion_id?: string;
  created_at: string;
}

export interface Crux {
  crux_claim: string;
  topic: string;
  subtopic: string;
  agree_agents: string[];
  disagree_agents: string[];
  no_clear_position: string[];
  controversy_score: number;
  explanation: string;
  crux_type?: string;
  resolvability?: number;
  degenerate?: boolean;
}

export interface OpinionCluster {
  cluster_id: number;
  agent_ids: string[];
  representative_positions: string[];
  size: number;
}

export interface ConsensusStatement {
  position_id: string;
  content: string;
  overall_agree_ratio: number;
  min_cluster_agree_ratio: number;
}

export interface BridgingStatement {
  position_id: string;
  agent_id: string;
  content: string;
  bridging_score: number;
  overall_agree_rate: number;
  cluster_agree_rate: Record<string, number>;
}

export interface Coalition {
  agent_ids: string[];
  shared_cruxes: number;
  stability_score: number;
}

export interface TopicSummary {
  topic_id?: string;
  topic: string;
  summary: string;
}

export interface AuditEntry {
  stage: string;
  detail: string;
  count?: number;
}

export interface AnalysisResult {
  deliberation_id: string;
  round_number: number;
  clusters: OpinionCluster[];
  cruxes: Crux[];
  discarded_cruxes?: Crux[];
  consensus_statements: ConsensusStatement[];
  bridging_statements?: BridgingStatement[];
  topic_summaries: TopicSummary[];
  agent_count: number;
  position_count: number;
  vote_count: number;
  confidence: string;
  coalitions?: Coalition[];
  compromise_proposal?: string;
  trust_weights?: Record<string, number>;
  correlation_weights?: Record<string, number>;
  effective_weights?: Record<string, number>;
  integrity_warnings?: string[];
  audit_log?: AuditEntry[];
  participation_rate?: number;
  perspective_diversity?: number;
  // Validation results (populated by pipelines that run validation)
  null_control?: NullControlResult;
  verification?: VerificationResult;
  replication?: ReplicationResult;
  coverage_gaps?: CoverageGap[];
}

export interface ValidationMetrics {
  crux_count: number;
  avg_controversy: number;
  consensus_count: number;
  bridging_count: number;
  cluster_count: number;
  confidence: string;
}

export interface NullControlResult {
  null_delib_id: string;
  real_metrics: ValidationMetrics;
  null_metrics: ValidationMetrics;
  failed_metrics?: string[];
  pass: boolean;
}

export interface VerificationResult {
  total: number;
  checked: number;
  downgraded: number;
  threshold: number;
  score_dist: number[]; // index 0-5, count per score
  details?: VerifyDetail[];
}

export interface VerifyDetail {
  speaker: string;
  crux: string;
  orig_stance: string;
  score: number;
  reason: string;
}

export interface ReplicationResult {
  num_runs: number;
  delib_ids: string[];
  runs: ValidationMetrics[];
  stability: {
    tier: number;
    crux_cv: number;
    controv_cv: number;
    consensus_cv: number;
    all_stable: boolean;
  };
}

export interface CoverageGap {
  position: string;
  missing_perspective: string;
  suggested_source: string;
}

export interface AuditLog {
  operations: Record<string, string>[];
  analysis_decisions: AuditEntry[];
}

export interface AgentInfo {
  id: string;
  model_family: string;
  conviction: number;
  cluster_id?: number;
  x?: number;     // 0-100, optional positioned layout
  y?: number;     // 0-100, optional positioned layout
  lat?: number;   // latitude for world map projection
  lon?: number;   // longitude for world map projection
}

export interface DelibState {
  deliberation: Deliberation;
  positions: Position[];
  votes: Vote[];
  analysis?: AnalysisResult;
  audit_log?: AuditLog;
  agents: AgentInfo[];
}

export interface Snapshot {
  deliberations: Record<string, DelibState>;
  fetched_at: string;
}

// Graph types (derived from deliberation data)
export interface GraphEdge {
  a: string;
  b: string;
  delibID: string;
}

export interface GraphGroup {
  delibID: string;
  agents: string[];
}

export interface Graph {
  nodes: string[];
  edges: GraphEdge[];
  groupDelibID: string | null;
  groups: GraphGroup[];
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

// SSE event types
export type SSEMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'state'; data: { id: string; state: DelibState } }
  | { type: 'cycle'; data: { deliberation_id: string } }
  | { type: 'ping' };

// Theme types
export type Theme = 'minimal' | 'magi' | 'gastown';

export type AnimationPhase = 'idle' | 'moving' | 'ready';

// Server config
export interface ServerConfig {
  mode: 'demo' | 'replay' | 'live';
  cycle_interval: number;
  gemot_url: string;
}
