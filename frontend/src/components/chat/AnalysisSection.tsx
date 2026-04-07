import { useState, useEffect } from 'react';
import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface AnalysisSectionProps {
  analysis: AnalysisResult;
}

interface AnalysisCard {
  type: 'consensus' | 'cruxes' | 'bridging' | 'compromise';
  content: React.ReactNode;
}

/** Renders analysis results as styled cards in the chat thread, revealed one at a time. */
export function AnalysisSection({ analysis }: AnalysisSectionProps) {
  const consensus = analysis.consensus_statements ?? [];
  const cruxes = analysis.cruxes ?? [];
  const bridging = analysis.bridging_statements ?? [];
  const compromise = analysis.compromise_proposal;

  // Build ordered list of cards to reveal
  const cards: AnalysisCard[] = [];

  if (consensus.length > 0) {
    cards.push({
      type: 'consensus',
      content: (
        <>
          <div className="analysis-card-title">Consensus</div>
          {consensus.map((c, i) => (
            <div key={i} className="analysis-card-item">
              <span className="analysis-card-text">{c.content}</span>
              <span className="analysis-card-meta analysis-agree">
                {Math.round(c.overall_agree_ratio * 100)}% agreement
              </span>
            </div>
          ))}
        </>
      ),
    });
  }

  if (cruxes.length > 0) {
    cards.push({
      type: 'cruxes',
      content: (
        <>
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
        </>
      ),
    });
  }

  if (bridging.length > 0) {
    cards.push({
      type: 'bridging',
      content: (
        <>
          <div className="analysis-card-title">Bridging Positions</div>
          {bridging.map((b, i) => (
            <div key={i} className="analysis-card-item">
              <span className="analysis-card-text">{b.content}</span>
              <span className="analysis-card-meta">
                bridging {Math.round(b.bridging_score * 100)}%
              </span>
            </div>
          ))}
        </>
      ),
    });
  }

  if (compromise) {
    cards.push({
      type: 'compromise',
      content: (
        <>
          <div className="analysis-card-title">Compromise Proposal</div>
          <div className="analysis-card-item">
            <span className="analysis-card-text">{compromise}</span>
          </div>
        </>
      ),
    });
  }

  // Staggered reveal: show one card at a time
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    if (visibleCount >= cards.length) return;
    const timer = setTimeout(() => setVisibleCount(c => c + 1), visibleCount === 0 ? 500 : 1500);
    return () => clearTimeout(timer);
  }, [visibleCount, cards.length]);

  if (cards.length === 0) return null;

  return (
    <div className="analysis-section">
      {cards.slice(0, visibleCount).map((card, i) => (
        <div key={card.type} className={`analysis-card analysis-${card.type}`}
          style={{ animation: i === visibleCount - 1 ? 'analysisReveal 0.4s ease forwards' : undefined }}>
          {card.content}
        </div>
      ))}
    </div>
  );
}
