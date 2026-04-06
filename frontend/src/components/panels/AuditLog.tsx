import type { DelibState } from '../../types';
import { formatTime } from '../../lib/helpers';

interface AuditLogProps {
  ds: DelibState | null;
}

export function AuditLog({ ds }: AuditLogProps) {
  const ops = ds?.audit_log?.operations ?? [];
  if (ops.length === 0) return null;

  // Show last 20 operations, newest first
  const recent = ops.slice(-20).reverse();

  return (
    <div className="footer-panel audit-panel">
      <div className="footer-panel-title">Event Log</div>
      <div className="audit-list">
        {recent.map((op, i) => {
          const method = (op['method'] ?? '').replace('gemot/', '');
          const agent = op['agent_id'] ?? '';
          const time = formatTime(op['timestamp'] ?? '');
          return (
            <div key={i} className="audit-entry">
              <span className="audit-time">{time}</span>
              <span className="audit-method">{method}</span>
              {agent && <span className="audit-agent">{agent}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
