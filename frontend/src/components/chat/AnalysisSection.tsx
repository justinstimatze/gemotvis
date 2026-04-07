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

/** Renders analysis as regular chat bubbles in the conversation flow. */
export function AnalysisSection({ analysis, agentNames, typingSpeed, shouldType, onTypingComplete }: AnalysisSectionProps) {
  const messages = [
    formatConsensus(analysis),
    formatCruxes(analysis),
    formatBridging(analysis),
    formatCompromise(analysis),
  ].filter((m): m is string => m != null);

  if (messages.length === 0) return null;

  return (
    <>
      {messages.map((content, i) => (
        <ChatBubble
          key={i}
          agentId="analysis"
          content={content}
          isLeft={false}
          shouldType={shouldType && i === 0}
          agentNames={agentNames}
          typingSpeed={typingSpeed}
          agentColor="var(--vis-accent, #4f46e5)"
          onTypingComplete={i === messages.length - 1 ? onTypingComplete : undefined}
        />
      ))}
    </>
  );
}
