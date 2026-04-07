import { useState, useEffect, useMemo } from 'react';
import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';
import { ChatBubble } from './ChatBubble';

interface AnalysisSectionProps {
  analysis: AnalysisResult;
  agentNames: string[];
  typingSpeed: number;
  shouldType: boolean;
  onTypingComplete?: () => void;
}

function formatConsensus(analysis: AnalysisResult): string | null {
  const items = analysis.consensus_statements ?? [];
  if (items.length === 0) return null;
  const lines = ['## Consensus'];
  for (const c of items) {
    lines.push(`- ${c.content} **(${Math.round(c.overall_agree_ratio * 100)}% agreement)**`);
  }
  return lines.join('\n');
}

function formatCruxes(analysis: AnalysisResult): string | null {
  const cruxes = analysis.cruxes ?? [];
  if (cruxes.length === 0) return null;
  const lines = ['## Key Disagreements'];
  for (const crux of cruxes) {
    lines.push(`- ${crux.crux_claim} **(${Math.round(crux.controversy_score * 100)}% controversy)**`);
    const parts: string[] = [];
    if (crux.agree_agents.length > 0) parts.push(`Agree: ${crux.agree_agents.map(a => shortAgentID(a)).join(', ')}`);
    if (crux.disagree_agents.length > 0) parts.push(`Disagree: ${crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}`);
    if (parts.length > 0) lines.push(`  ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function formatBridging(analysis: AnalysisResult): string | null {
  const bridging = analysis.bridging_statements ?? [];
  if (bridging.length === 0) return null;
  const lines = ['## Bridging Positions'];
  for (const b of bridging) {
    lines.push(`- ${b.content} **(bridging ${Math.round(b.bridging_score * 100)}%)**`);
  }
  return lines.join('\n');
}

function formatCompromise(analysis: AnalysisResult): string | null {
  if (!analysis.compromise_proposal) return null;
  return `## Compromise Proposal\n${analysis.compromise_proposal}`;
}

/** Renders analysis as chat bubbles that fade in sequentially. No word-by-word typing. */
export function AnalysisSection({ analysis, agentNames, typingSpeed, onTypingComplete }: AnalysisSectionProps) {
  const messages = useMemo(() => [
    formatConsensus(analysis),
    formatCruxes(analysis),
    formatBridging(analysis),
    formatCompromise(analysis),
  ].filter((m): m is string => m != null), [analysis]);

  // Stagger: reveal one bubble at a time
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount >= messages.length) {
      if (visibleCount > 0) onTypingComplete?.();
      return;
    }
    const delay = visibleCount === 0 ? 400 : 2000;
    const timer = setTimeout(() => setVisibleCount(c => c + 1), delay);
    return () => clearTimeout(timer);
  }, [visibleCount, messages.length, onTypingComplete]);

  if (messages.length === 0) return null;

  return (
    <>
      {messages.slice(0, visibleCount).map((content, i) => (
        <div key={i} style={{ animation: 'analysisReveal 0.5s ease forwards' }}>
          <ChatBubble
            agentId="analysis"
            content={content}
            isLeft={true}
            shouldType={false}
            agentNames={agentNames}
            typingSpeed={typingSpeed}
            agentColor="var(--vis-accent, #4f46e5)"
          />
        </div>
      ))}
    </>
  );
}
