import type { DelibState } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface MetricsPanelProps {
  ds: DelibState | null;
}

export function MetricsPanel({ ds }: MetricsPanelProps) {
  const positions = ds?.positions ?? [];
  const votes = ds?.votes ?? [];
  const agents = ds?.agents ?? [];

  // Count messages per agent
  const msgCounts: Record<string, number> = {};
  for (const p of positions) {
    msgCounts[p.agent_id] = (msgCounts[p.agent_id] ?? 0) + 1;
  }

  const maxMsgs = Math.max(1, ...Object.values(msgCounts));

  return (
    <div className="footer-panel metrics-panel">
      <div className="footer-panel-title">Agent Activity</div>
      {agents.length === 0 ? (
        <div className="footer-panel-empty">No agents yet</div>
      ) : (
        <>
          <div className="metrics-agents">
            {agents.map((a) => {
              const count = msgCounts[a.id] ?? 0;
              const pct = (count / maxMsgs) * 100;
              return (
                <div key={a.id} className="metrics-agent">
                  <span className="metrics-name">{shortAgentID(a.id)}</span>
                  <div className="metrics-bar-bg">
                    <div className="metrics-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="metrics-count">{count}</span>
                </div>
              );
            })}
          </div>
          <div className="metrics-summary">
            {positions.length} positions &middot; {votes.length} votes &middot; {agents.length} agents
          </div>
        </>
      )}
    </div>
  );
}
