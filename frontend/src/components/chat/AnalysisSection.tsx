import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AnalysisResult } from '../../types';
import { shortAgentID } from '../../lib/helpers';
import { ChatBubble } from './ChatBubble';
import { useGraphStore } from '../../stores/graph';

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
    lines.push(`- ${c.content}`);
    lines.push(`  ${Math.round(c.overall_agree_ratio * 100)}% agreement`);
  }
  return lines.join('\n');
}

function formatCruxes(analysis: AnalysisResult): string | null {
  const cruxes = analysis.cruxes ?? [];
  if (cruxes.length === 0) return null;
  const lines = ['## Key Disagreements'];
  for (const crux of cruxes) {
    lines.push(`- ${crux.crux_claim}`);
    const parts: string[] = [];
    if (crux.agree_agents.length > 0) parts.push(`Agree: ${crux.agree_agents.map(a => shortAgentID(a)).join(', ')}`);
    if (crux.disagree_agents.length > 0) parts.push(`Disagree: ${crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}`);
    parts.unshift(`${Math.round(crux.controversy_score * 100)}% controversy`);
    lines.push(`  ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function formatBridging(analysis: AnalysisResult): string | null {
  const bridging = analysis.bridging_statements ?? [];
  if (bridging.length === 0) return null;
  const lines = ['## Bridging Positions'];
  for (const b of bridging) {
    lines.push(`- ${b.content}`);
    lines.push(`  bridging ${Math.round(b.bridging_score * 100)}%`);
  }
  return lines.join('\n');
}

function formatCompromise(analysis: AnalysisResult): string | null {
  if (!analysis.compromise_proposal) return null;
  return `## Compromise Proposal\n${analysis.compromise_proposal}`;
}

/** Renders analysis as chat bubbles with typing, revealed one at a time. */
export function AnalysisSection({ analysis, agentNames, typingSpeed, shouldType, onTypingComplete }: AnalysisSectionProps) {
  const messages = useMemo(() => [
    formatConsensus(analysis),
    formatCruxes(analysis),
    formatBridging(analysis),
    formatCompromise(analysis),
  ].filter((m): m is string => m != null), [analysis]);

  const [visibleCount, setVisibleCount] = useState(shouldType ? 0 : messages.length);

  const setSpeakingAgent = useGraphStore((s) => s.setSpeakingAgent);

  // Stagger: first bubble after 400ms, then each after previous finishes typing
  useEffect(() => {
    if (!shouldType || visibleCount > 0 || messages.length === 0) return;
    const timer = setTimeout(() => {
      setVisibleCount(1);
      setSpeakingAgent('analysis');
    }, 400);
    return () => clearTimeout(timer);
  }, [shouldType, visibleCount, messages.length, setSpeakingAgent]);

  const advanceToNext = useCallback(() => {
    setVisibleCount(c => {
      const next = c + 1;
      if (next >= messages.length) {
        setSpeakingAgent(null);
        onTypingComplete?.();
      } else {
        setSpeakingAgent('analysis');
      }
      return next;
    });
  }, [messages.length, onTypingComplete, setSpeakingAgent]);

  if (messages.length === 0) return null;

  return (
    <>
      {messages.slice(0, visibleCount).map((content, i) => {
        const isLatest = shouldType && i === visibleCount - 1;
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
