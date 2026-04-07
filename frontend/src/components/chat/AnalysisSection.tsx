import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface AnalysisSectionProps {
  analysis: AnalysisResult;
}

/** Renders analysis results as styled system messages in the chat thread. */
export function AnalysisSection({ analysis }: AnalysisSectionProps) {
  const consensus = analysis.consensus_statements ?? [];
  const cruxes = analysis.cruxes ?? [];
  const bridging = analysis.bridging_statements ?? [];
  const compromise = analysis.compromise_proposal;

  return (
    <div className="analysis-section">
      {consensus.length > 0 && (
        <div className="analysis-card analysis-consensus">
          <div className="analysis-card-title">Consensus</div>
          {consensus.map((c, i) => (
            <div key={i} className="analysis-card-item">
              <span className="analysis-card-text">{c.content}</span>
              <span className="analysis-card-meta analysis-agree">
                {Math.round(c.overall_agree_ratio * 100)}% agreement
              </span>
            </div>
          ))}
        </div>
      )}

      {cruxes.length > 0 && (
        <div className="analysis-card analysis-cruxes">
          <div className="analysis-card-title">Key Disagreements</div>
          {cruxes.map((crux, i) => (
            <div key={i} className="analysis-card-item">
              <span className="analysis-card-text">{crux.crux_claim}</span>
              <div className="analysis-card-agents">
                <span className="analysis-card-meta">
                  {Math.round(crux.controversy_score * 100)}% controversy
                </span>
                {crux.agree_agents.length > 0 && (
                  <span className="analysis-agree">
                    {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}
                  </span>
                )}
                {crux.disagree_agents.length > 0 && (
                  <span className="analysis-disagree">
                    {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {bridging.length > 0 && (
        <div className="analysis-card analysis-bridging">
          <div className="analysis-card-title">Bridging Positions</div>
          {bridging.map((b, i) => (
            <div key={i} className="analysis-card-item">
              <span className="analysis-card-text">{b.content}</span>
              <span className="analysis-card-meta">
                bridging {Math.round(b.bridging_score * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {compromise && (
        <div className="analysis-card analysis-compromise">
          <div className="analysis-card-title">Compromise Proposal</div>
          <div className="analysis-card-item">
            <span className="analysis-card-text">{compromise}</span>
          </div>
        </div>
      )}
    </div>
  );
}
