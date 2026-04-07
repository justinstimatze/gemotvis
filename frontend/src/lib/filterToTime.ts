import type { DelibState } from '../types';

interface FilterContext {
  /** ID of the focused deliberation (active edge, focused delib, or active delib). */
  focusedDelibID: string | null;
  /** Whether the scrubber is enabled. */
  scrubberEnabled: boolean;
  /** Current scrubber event index (null = live). */
  scrubberEventIndex: number | null;
  /** Full scrubber event list (for counting per-delib events). */
  scrubberEvents: { delibID?: string }[];
}

/**
 * Filter a deliberation's state to show only data up to the scrubber position.
 *
 * For the focused deliberation: count how many of its events the scrubber has passed.
 * For background deliberations: filter by timestamp cutoff.
 * When scrubber is disabled: return all data.
 */
export function filterToTime(
  ds: DelibState,
  cutoffTime: string | null,
  ctx: FilterContext,
): DelibState {
  const ops = ds.audit_log?.operations ?? [];
  const delibID = ds.deliberation?.deliberation_id;

  let filteredOps: Record<string, string>[];
  const isFocused = delibID != null && ctx.focusedDelibID === delibID;

  if (ctx.scrubberEnabled && ctx.scrubberEventIndex != null && isFocused) {
    // Focused: count how many of this delib's events the scrubber has passed
    let count = 0;
    for (let i = 0; i <= ctx.scrubberEventIndex; i++) {
      if (ctx.scrubberEvents[i]?.delibID === delibID) count++;
    }
    filteredOps = ops.slice(0, count);
  } else if (ctx.scrubberEnabled && ctx.scrubberEventIndex != null && cutoffTime) {
    // Background: use timestamp cutoff
    const cutoff = new Date(cutoffTime).getTime();
    filteredOps = ops.filter(op => new Date(op['timestamp'] ?? '').getTime() <= cutoff);
  } else {
    filteredOps = ops;
  }

  // Count revealed events by type.
  // Always use scrubber events for position/vote counts (audit log may not contain them).
  // Use audit log only for lifecycle events (analysis).
  let posOpsCount = 0, voteOpsCount = 0, hasAnalysisOp = false;

  if (ctx.scrubberEnabled && isFocused) {
    // Scrubber active: count events up to current index (null = not started = show nothing)
    if (ctx.scrubberEventIndex != null) {
      for (let i = 0; i <= ctx.scrubberEventIndex; i++) {
        const evt = ctx.scrubberEvents[i] as { delibID?: string; type?: string };
        if (evt?.delibID !== delibID) continue;
        if (evt.type === 'position') posOpsCount++;
        else if (evt.type === 'vote') voteOpsCount++;
        else if (evt.type === 'analysis') hasAnalysisOp = true;
      }
    }
    // else: scrubber enabled but not started → posOpsCount stays 0
  } else if (!ctx.scrubberEnabled) {
    // No scrubber: show all
    posOpsCount = (ds.positions ?? []).length;
    voteOpsCount = (ds.votes ?? []).length;
    hasAnalysisOp = !!ds.analysis;
  }

  const positions = (ds.positions ?? []).slice(0, posOpsCount);
  const votes = (ds.votes ?? []).slice(0, voteOpsCount);

  const visibleAgentIDs = new Set(positions.map(p => p.agent_id));
  const agents = (ds.agents ?? []).filter(a => visibleAgentIDs.has(a.id));

  const analysis = hasAnalysisOp ? ds.analysis ?? null : null;
  const filteredAgents = analysis ? agents : agents.map(a => ({ ...a, cluster_id: undefined }));

  return {
    deliberation: ds.deliberation,
    positions,
    votes,
    analysis: analysis ?? undefined,
    audit_log: ds.audit_log ? { ...ds.audit_log, operations: filteredOps } : undefined,
    agents: filteredAgents,
  };
}
