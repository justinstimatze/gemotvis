import type { DelibState } from '../types';
import { shortAgentID } from './helpers';

export interface TimelineEvent {
  time: string;
  label: string;
  type: 'position' | 'vote' | 'analysis' | 'other';
  delibID: string;
  index: number;
}

/** Build timeline events from a single deliberation.
 *  Always synthesizes position/vote events from data timestamps.
 *  Merges audit log lifecycle events (analysis, round changes) if available. */
export function buildTimelineEvents(ds: DelibState): TimelineEvent[] {
  const delibID = ds.deliberation?.deliberation_id ?? '';

  // Always build position/vote events from actual data
  const events = synthesizeEvents(ds);

  // Merge audit log lifecycle events (analysis, admin ops) that aren't position/vote
  const ops = ds.audit_log?.operations ?? [];
  for (const op of ops) {
    const method = op['method'] ?? '';
    // Skip position/vote ops — we already have those from the data
    if (method.includes('submit_position') || method.includes('participate:submit') ||
        method.includes('vote') || method.includes('participate:vote')) continue;

    let type: TimelineEvent['type'] = 'other';
    let label = method;

    if (method.includes('analy') || method.includes('analyze:')) {
      type = 'analysis';
      label = method.includes('complete') || method.includes('result')
        ? 'Analysis complete' : 'Analysis started';
    }

    events.push({ time: op['timestamp'] ?? '', label, type, delibID, index: events.length });
  }

  // Sort: positions first, then votes, then analysis/lifecycle — within each group by timestamp
  const typePriority: Record<string, number> = { position: 0, vote: 1, analysis: 2, other: 3 };
  return events.sort((a, b) => {
    const pa = typePriority[a.type] ?? 3;
    const pb = typePriority[b.type] ?? 3;
    if (pa !== pb) return pa - pb;
    if (!a.time || !b.time) return 0;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });
}

/** Synthesize timeline events from positions and votes when no audit log exists. */
function synthesizeEvents(ds: DelibState): TimelineEvent[] {
  const delibID = ds.deliberation?.deliberation_id ?? '';
  const events: TimelineEvent[] = [];

  for (const p of ds.positions ?? []) {
    events.push({
      time: p.created_at ?? '',
      label: `${shortAgentID(p.agent_id)} submits position`,
      type: 'position',
      delibID,
      index: events.length,
    });
  }

  for (const v of ds.votes ?? []) {
    events.push({
      time: v.created_at ?? '',
      label: `${shortAgentID(v.agent_id)} votes`,
      type: 'vote',
      delibID,
      index: events.length,
    });
  }

  if (ds.analysis) {
    events.push({
      time: '',
      label: 'Analysis complete',
      type: 'analysis',
      delibID,
      index: events.length,
    });
  }

  return events.sort((a, b) => {
    if (!a.time || !b.time) return 0;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });
}

/** Build a global timeline from ALL deliberations (for multi-view replay). */
export function buildGlobalTimeline(delibs: Record<string, DelibState>): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const [delibID, ds] of Object.entries(delibs)) {
    const topic = ds.deliberation?.topic ?? delibID;
    const shortTopic = topic.length > 30 ? topic.slice(0, 28) + '..' : topic;

    const delibEvents = buildTimelineEvents(ds);
    for (const evt of delibEvents) {
      events.push({
        ...evt,
        label: `${shortTopic}: ${evt.label}`,
        delibID,
      });
    }
  }

  // Sort: within each delib, positions before votes before analysis.
  // Across delibs, interleave by timestamp.
  const typePriority: Record<string, number> = { position: 0, vote: 1, analysis: 2, other: 3 };
  return events.sort((a, b) => {
    if (a.delibID !== b.delibID) {
      if (!a.time || !b.time) return 0;
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    }
    const pa = typePriority[a.type] ?? 3;
    const pb = typePriority[b.type] ?? 3;
    if (pa !== pb) return pa - pb;
    if (!a.time || !b.time) return 0;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });
}
