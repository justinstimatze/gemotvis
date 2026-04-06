import type { DelibState } from '../types';
import { shortAgentID } from './helpers';

export interface TimelineEvent {
  time: string;
  label: string;
  type: 'position' | 'vote' | 'analysis' | 'other';
  delibID: string;
  index: number;
}

/** Build timeline events from a single deliberation. Uses audit log if available, falls back to positions/votes. */
export function buildTimelineEvents(ds: DelibState): TimelineEvent[] {
  const ops = ds.audit_log?.operations ?? [];
  const delibID = ds.deliberation?.deliberation_id ?? '';

  // If audit log has entries, use it
  if (ops.length > 0) {
    return ops.map((op, i) => {
      const method = (op['method'] ?? '').replace('gemot/', '');
      let type: TimelineEvent['type'] = 'other';
      let label = method;

      if (method.includes('submit_position')) {
        type = 'position';
        label = `${shortAgentID(op['agent_id'] ?? '')} submits position`;
      } else if (method.includes('vote')) {
        type = 'vote';
        label = `${shortAgentID(op['agent_id'] ?? '')} votes`;
      } else if (method.includes('analy')) {
        type = 'analysis';
        label = method.includes('complete') || method.includes('result')
          ? 'Analysis complete' : 'Analysis started';
      }

      return { time: op['timestamp'] ?? '', label, type, delibID, index: i };
    }).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  // Fallback: synthesize from positions and votes
  return synthesizeEvents(ds);
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

  return events.sort((a, b) => {
    if (!a.time || !b.time) return 0;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });
}
