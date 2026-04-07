import { useState, useEffect, useCallback, useMemo } from 'react';
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

/** Renders analysis as sequential chat bubbles — one at a time, each types then reveals the next. */
export function AnalysisSection({ analysis, agentNames, typingSpeed, shouldType, onTypingComplete }: AnalysisSectionProps) {
  const messages = useMemo(() => [
    formatConsensus(analysis),
    formatCruxes(analysis),
    formatBridging(analysis),
    formatCompromise(analysis),
  ].filter((m): m is string => m != null), [analysis]);

  const [visibleCount, setVisibleCount] = useState(shouldType ? 0 : messages.length);

  // Start revealing first bubble after a short delay
  useEffect(() => {
    if (!shouldType || visibleCount > 0 || messages.length === 0) return;
    const timer = setTimeout(() => setVisibleCount(1), 400);
    return () => clearTimeout(timer);
  }, [shouldType, visibleCount, messages.length]);

  const advanceToNext = useCallback(() => {
    setVisibleCount(c => {
      const next = c + 1;
      if (next >= messages.length) onTypingComplete?.();
      return next;
    });
  }, [messages.length, onTypingComplete]);

  if (messages.length === 0) return null;

  // If not typing, show all immediately
  if (!shouldType) {
    return (
      <>
        {messages.map((content, i) => (
          <ChatBubble
            key={i}
            agentId="analysis"
            content={content}
            isLeft={true}
            shouldType={false}
            agentNames={agentNames}
            typingSpeed={typingSpeed}
            agentColor="var(--vis-accent, #4f46e5)"
          />
        ))}
      </>
    );
  }

  return (
    <>
      {messages.slice(0, visibleCount).map((content, i) => {
        const isLatest = i === visibleCount - 1;
        return (
          <ChatBubble
            key={i}
            agentId="analysis"
            content={content}
            isLeft={true}
            shouldType={isLatest}
            agentNames={agentNames}
            typingSpeed={typingSpeed}
            agentColor="var(--vis-accent, #4f46e5)"
            onTypingComplete={isLatest ? advanceToNext : undefined}
          />
        );
      })}
    </>
  );
}
