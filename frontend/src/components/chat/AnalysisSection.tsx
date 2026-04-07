import { useState, useEffect, useCallback } from 'react';
import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';

interface AnalysisSectionProps {
  analysis: AnalysisResult;
}

/** Simple word-by-word text reveal for analysis content. */
function TypingText({ text, speed = 30, onComplete }: { text: string; speed?: number; onComplete?: () => void }) {
  const words = text.split(/(\s+)/);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count >= words.length) {
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => setCount(c => c + 1), speed);
    return () => clearTimeout(timer);
  }, [count, words.length, speed, onComplete]);

  return <>{words.slice(0, count).join('')}{count < words.length && <span className="typing-cursor" />}</>;
}

interface CardDef {
  type: 'consensus' | 'cruxes' | 'bridging' | 'compromise';
  title: string;
  items: { text: string; meta?: string; agents?: { agree: string[]; disagree: string[] } }[];
}

/** Renders analysis results as styled cards in the chat thread, revealed one at a time with typing. */
export function AnalysisSection({ analysis }: AnalysisSectionProps) {
  const consensus = analysis.consensus_statements ?? [];
  const cruxes = analysis.cruxes ?? [];
  const bridging = analysis.bridging_statements ?? [];
  const compromise = analysis.compromise_proposal;

  const cards: CardDef[] = [];

  if (consensus.length > 0) {
    cards.push({
      type: 'consensus',
      title: 'Consensus',
      items: consensus.map(c => ({
        text: c.content,
        meta: `${Math.round(c.overall_agree_ratio * 100)}% agreement`,
      })),
    });
  }

  if (cruxes.length > 0) {
    cards.push({
      type: 'cruxes',
      title: 'Key Disagreements',
      items: cruxes.map(crux => ({
        text: crux.crux_claim,
        meta: `${Math.round(crux.controversy_score * 100)}% controversy`,
        agents: { agree: crux.agree_agents, disagree: crux.disagree_agents },
      })),
    });
  }

  if (bridging.length > 0) {
    cards.push({
      type: 'bridging',
      title: 'Bridging Positions',
      items: bridging.map(b => ({
        text: b.content,
        meta: `bridging ${Math.round(b.bridging_score * 100)}%`,
      })),
    });
  }

  if (compromise) {
    cards.push({
      type: 'compromise',
      title: 'Compromise Proposal',
      items: [{ text: compromise }],
    });
  }

  // Staggered reveal: show one card at a time, advance when typing completes
  const [visibleCount, setVisibleCount] = useState(0);
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    if (visibleCount >= cards.length) return;
    if (visibleCount === 0) {
      const timer = setTimeout(() => setVisibleCount(1), 500);
      return () => clearTimeout(timer);
    }
    if (typingDone) {
      setTypingDone(false);
      const timer = setTimeout(() => setVisibleCount(c => c + 1), 800);
      return () => clearTimeout(timer);
    }
  }, [visibleCount, typingDone, cards.length]);

  const onCardTypingComplete = useCallback(() => setTypingDone(true), []);

  if (cards.length === 0) return null;

  return (
    <div className="analysis-section">
      {cards.slice(0, visibleCount).map((card, i) => {
        const isLatest = i === visibleCount - 1;
        return (
          <div key={card.type} className={`analysis-card analysis-${card.type}`}
            style={{ animation: isLatest ? 'analysisReveal 0.4s ease forwards' : undefined }}>
            <div className="analysis-card-title">{card.title}</div>
            {card.items.map((item, j) => (
              <div key={j} className="analysis-card-item">
                <span className="analysis-card-text">
                  {isLatest ? (
                    <TypingText
                      text={item.text}
                      onComplete={j === card.items.length - 1 ? onCardTypingComplete : undefined}
                    />
                  ) : item.text}
                </span>
                {item.meta && (
                  <span className={`analysis-card-meta ${card.type === 'consensus' ? 'analysis-agree' : ''}`}>
                    {isLatest ? null : item.meta}
                  </span>
                )}
                {!isLatest && item.meta && <span className={`analysis-card-meta ${card.type === 'consensus' ? 'analysis-agree' : ''}`} style={{ display: 'none' }} />}
                {item.agents && (
                  <div className="analysis-card-agents">
                    {!isLatest && <span className="analysis-card-meta">{item.meta}</span>}
                    {item.agents.agree.length > 0 && (
                      <span className="analysis-agree">
                        {item.agents.agree.map(a => shortAgentID(a)).join(', ')}
                      </span>
                    )}
                    {item.agents.disagree.length > 0 && (
                      <span className="analysis-disagree">
                        {item.agents.disagree.map(a => shortAgentID(a)).join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
