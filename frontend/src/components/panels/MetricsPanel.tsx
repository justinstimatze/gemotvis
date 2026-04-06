import type { DelibState } from '../../types';

interface MetricsPanelProps {
  ds: DelibState | null;
}

export function MetricsPanel({ ds }: MetricsPanelProps) {
  const positions = ds?.positions ?? [];
  const votes = ds?.votes ?? [];
  const agents = ds?.agents ?? [];
  const analysis = ds?.analysis;
  const delib = ds?.deliberation;

  const round = delib?.round_number ?? 0;
  const status = delib?.status ?? '';
  const confidence = analysis?.confidence ?? '';
  const consensusCount = analysis?.consensus_statements?.length ?? 0;
  const cruxCount = analysis?.cruxes?.length ?? 0;
  const clusterCount = analysis?.clusters?.length ?? 0;

  // Vote summary
  const agree = votes.filter(v => v.value === 1).length;
  const disagree = votes.filter(v => v.value === -1).length;
  const neutral = votes.filter(v => v.value === 0).length;

  return (
    <div className="footer-panel metrics-panel">
      <div className="footer-panel-title">Summary</div>
      {agents.length === 0 ? (
        <div className="footer-panel-empty">No data yet</div>
      ) : (
        <div className="metrics-grid">
          <div className="metrics-stat">
            <span className="metrics-stat-value">{agents.length}</span>
            <span className="metrics-stat-label">agents</span>
          </div>
          <div className="metrics-stat">
            <span className="metrics-stat-value">{positions.length}</span>
            <span className="metrics-stat-label">positions</span>
          </div>
          {votes.length > 0 && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">
                <span style={{color: 'var(--vis-green, #16a34a)'}}>{agree}</span>
                /
                <span style={{color: 'var(--vis-red, #dc2626)'}}>{disagree}</span>
                /
                <span>{neutral}</span>
              </span>
              <span className="metrics-stat-label">votes</span>
            </div>
          )}
          {round > 0 && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">{round}</span>
              <span className="metrics-stat-label">round</span>
            </div>
          )}
          {consensusCount > 0 && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">{consensusCount}</span>
              <span className="metrics-stat-label">consensus</span>
            </div>
          )}
          {cruxCount > 0 && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">{cruxCount}</span>
              <span className="metrics-stat-label">cruxes</span>
            </div>
          )}
          {clusterCount > 0 && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">{clusterCount}</span>
              <span className="metrics-stat-label">clusters</span>
            </div>
          )}
          {status && (
            <div className="metrics-stat">
              <span className={`metrics-status metrics-status-${status}`}>{status}</span>
            </div>
          )}
          {confidence && (
            <div className="metrics-stat">
              <span className="metrics-stat-value">{confidence}</span>
              <span className="metrics-stat-label">confidence</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
