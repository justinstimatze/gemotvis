import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface AnalysisSectionProps {
  analysis: AnalysisResult;
}

export function AnalysisSection({ analysis }: AnalysisSectionProps) {
  const consensus = analysis.consensus_statements ?? [];
  const bridging = analysis.bridging_statements ?? [];
  const compromise = analysis.compromise_proposal;

  return (
    <div className="analysis-section">
      {consensus.length > 0 && (
        <div className="analysis-block">
          <div className="analysis-block-title">Consensus</div>
          {consensus.map((c, i) => (
            <div key={i} className="analysis-item consensus-item">
              <div className="analysis-content">{c.content}</div>
              <div className="analysis-meta">
                {Math.round(c.overall_agree_ratio * 100)}% agreement
              </div>
            </div>
          ))}
        </div>
      )}

      {bridging.length > 0 && (
        <div className="analysis-block">
          <div className="analysis-block-title">Bridging Positions</div>
          {bridging.map((b, i) => (
            <div key={i} className="analysis-item bridging-item">
              <div className="analysis-content">{b.content}</div>
              <div className="analysis-meta">
                by {shortAgentID(b.agent_id)} &middot; score {Math.round(b.bridging_score * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {compromise && (
        <div className="analysis-block">
          <div className="analysis-block-title">Compromise Proposal</div>
          <div className="analysis-item compromise-item">
            <div className="analysis-content">{compromise}</div>
          </div>
        </div>
      )}
    </div>
  );
}
