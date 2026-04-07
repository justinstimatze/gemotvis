import { useRef, useEffect, useMemo, useCallback } from 'react';
import type { Position as PositionType, AgentInfo, AnalysisResult } from '../../types';
import { collectAgentNames, classNames, isLiveRoute } from '../../lib/helpers';
import { AnalysisSection } from './AnalysisSection';
import { agentColor } from '../../lib/color';
import { ChatBubble } from './ChatBubble';
import { useGraphStore } from '../../stores/graph';
import { useThemeStore } from '../../stores/theme';
import { useScrubberStore } from '../../stores/scrubber';

interface ChatThreadProps {
  positions: PositionType[];
  agents: AgentInfo[];
  allAgents: AgentInfo[];
  searchQuery?: string;
  analysis?: AnalysisResult;
}

function searchClasses(query: string, content: string, agentId: string): string {
  if (!query) return '';
  const q = query.toLowerCase();
  const matches = content.toLowerCase().includes(q) || agentId.toLowerCase().includes(q);
  return matches ? 'chat-bubble-search-match' : 'chat-bubble-search-dim';
}

export function ChatThread({ positions, agents, allAgents, searchQuery, analysis }: ChatThreadProps) {
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const activeNode = useGraphStore((s) => s.activeNode);
  const playing = useScrubberStore((s) => s.playing);
  const speed = useScrubberStore((s) => s.speed);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const bubbleRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const setBubbleRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) bubbleRefs.current.set(idx, el);
    else bubbleRefs.current.delete(idx);
  }, []);

  const theme = useThemeStore((s) => s.activeTheme);
  const isLive = useMemo(() => isLiveRoute(), []);
  const agentIDs = useMemo(() => agents.map((a) => a.id), [agents]);
  const agentNames = useMemo(() => collectAgentNames(allAgents), [allAgents]);
  // Read graph node list from store — exact same ordering as AgentNode colors
  const graphNodes = useGraphStore((s) => s.graphNodes);
  const agentCount = graphNodes.length;
  const typingSpeed = useMemo(() => Math.max(20, speed / 200), [speed]);

  // Auto-scroll on new positions
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [positions.length]);

  // Scroll during active typing — frequent enough to track line-by-line reveals
  const speakingAgent = useGraphStore((s) => s.speakingAgent);
  useEffect(() => {
    if (!speakingAgent) return;
    const interval = setInterval(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 150);
    return () => clearInterval(interval);
  }, [speakingAgent]);

  // Track position count for "is new" detection + set speaking agent
  const setSpeakingAgent = useGraphStore((s) => s.setSpeakingAgent);
  const clearSpeakingAgent = useCallback(() => setSpeakingAgent(null), [setSpeakingAgent]);
  useEffect(() => {
    if (!playing) {
      setSpeakingAgent(null);
      return;
    }
    const isNewPosition = positions.length > prevCountRef.current;
    if (isNewPosition && animationPhase === 'ready') {
      const newest = positions[positions.length - 1];
      if (newest) setSpeakingAgent(newest.agent_id);
    }
    prevCountRef.current = positions.length;
  }, [positions.length, playing, animationPhase, positions, setSpeakingAgent]);

  // Scroll to highlighted agent's last message
  useEffect(() => {
    if (!activeNode) return;
    for (let i = positions.length - 1; i >= 0; i--) {
      if (positions[i]?.agent_id === activeNode) {
        bubbleRefs.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }, [activeNode, positions]);

  if (positions.length === 0) return null;

  const query = searchQuery ?? '';

  return (
    <div className="center-content" ref={contentRef}>
      <div className="chat-thread">
        {positions.map((p, idx) => {
          const isLeft = agentIDs.indexOf(p.agent_id) % 2 === 0;
          const isNewest = idx === positions.length - 1;
          const shouldType = !isLive && isNewest && playing && animationPhase === 'ready';
          const colorIdx = graphNodes.indexOf(p.agent_id);
          const color = agentColor(colorIdx >= 0 ? colorIdx : 0, agentCount, theme);

          return (
            <div
              key={p.position_id}
              ref={(el) => setBubbleRef(idx, el)}
              className={classNames(
                activeNode === p.agent_id && 'chat-bubble-highlighted',
                searchClasses(query, p.content, p.agent_id),
              )}
            >
              <ChatBubble
                agentId={p.agent_id}
                content={p.content}
                isLeft={isLeft}
                shouldType={shouldType}
                agentNames={agentNames}
                typingSpeed={typingSpeed}
                agentColor={color}
                onTypingComplete={shouldType ? clearSpeakingAgent : undefined}
              />
            </div>
          );
        })}
        {analysis && (
          <AnalysisSection
            analysis={analysis}
            agentNames={agentNames}
            typingSpeed={typingSpeed}
            shouldType={false}
            onTypingComplete={clearSpeakingAgent}
          />
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
