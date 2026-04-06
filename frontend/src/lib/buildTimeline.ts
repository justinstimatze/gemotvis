import type { DelibState } from '../types';
import { shortAgentID } from './helpers';

export interface TimelineEvent {
  time: string;
  label: string;
  type: 'position' | 'vote' | 'analysis' | 'other';
  delibID: string;
  index: number;
}

/** Build timeline events from a single deliberation's audit log. */
export function buildTimelineEvents(ds: DelibState): TimelineEvent[] {
  const ops = ds.audit_log?.operations ?? [];
  const delibID = ds.deliberation?.deliberation_id ?? '';

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

/** Build a global timeline from ALL deliberations (for multi-view replay). */
export function buildGlobalTimeline(delibs: Record<string, DelibState>): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const [delibID, ds] of Object.entries(delibs)) {
    const topic = ds.deliberation?.topic ?? delibID;
    const shortTopic = topic.length > 30 ? topic.slice(0, 28) + '..' : topic;
    const ops = ds.audit_log?.operations ?? [];

    ops.forEach((op, i) => {
      const method = (op['method'] ?? '').replace('gemot/', '');
      let type: TimelineEvent['type'] = 'other';
      let action = method;

      if (method.includes('submit_position')) {
        type = 'position';
        action = `${shortAgentID(op['agent_id'] ?? '')} submits position`;
      } else if (method.includes('vote')) {
        type = 'vote';
        action = `${shortAgentID(op['agent_id'] ?? '')} votes`;
      } else if (method.includes('analy')) {
        type = 'analysis';
        action = method.includes('complete') || method.includes('result')
          ? 'Analysis complete' : 'Analysis started';
      }

      events.push({
        time: op['timestamp'] ?? '',
        label: `${shortTopic}: ${action}`,
        type,
        delibID,
        index: i,
      });
    });
  }

  return events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}
