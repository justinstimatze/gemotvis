import type { DelibState } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface CruxPanelProps {
  ds: DelibState | null;
}

export function CruxPanel({ ds }: CruxPanelProps) {
  const cruxes = ds?.analysis?.cruxes ?? [];

  return (
    <div className="footer-panel crux-panel">
      <div className="footer-panel-title">Key Disagreements</div>
      {cruxes.length === 0 ? (
        <div className="footer-panel-empty">Awaiting analysis</div>
      ) : (
        <div className="crux-list">
          {cruxes.map((crux, i) => (
            <div key={i} className="crux-item">
              <div className="crux-claim">{crux.crux_claim}</div>
              <div className="crux-meta">
                <span className="crux-score">
                  {Math.round(crux.controversy_score * 100)}% controversy
                </span>
                {crux.agree_agents.length > 0 && (
                  <span className="crux-agents crux-agree">
                    {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}
                  </span>
                )}
                {crux.disagree_agents.length > 0 && (
                  <span className="crux-agents crux-disagree">
                    {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
