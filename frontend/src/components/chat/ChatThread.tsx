import { useRef, useEffect, useMemo, useCallback } from 'react';
import type { Position as PositionType, AgentInfo } from '../../types';
import { collectAgentNames } from '../../lib/helpers';
import { ChatBubble } from './ChatBubble';
import { useGraphStore } from '../../stores/graph';
import { useScrubberStore } from '../../stores/scrubber';

interface ChatThreadProps {
  positions: PositionType[];
  agents: AgentInfo[];
  allAgents: AgentInfo[]; // from all deliberations, for mention highlighting
}

export function ChatThread({ positions, agents, allAgents }: ChatThreadProps) {
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

  const agentIDs = useMemo(() => agents.map((a) => a.id), [agents]);
  const agentNames = useMemo(() => collectAgentNames(allAgents), [allAgents]);

  // Typing speed: derive from scrubber speed
  const typingSpeed = useMemo(() => {
    // ~60ms per word at 1x, faster at higher speeds
    return Math.max(20, speed / 200);
  }, [speed]);

  // Auto-scroll: use a sentinel div at the bottom that scrolls into view
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll on position count change
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [positions.length]);

  // Also scroll periodically during typing to keep up with word reveal
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 500);
    return () => clearInterval(interval);
  }, [playing]);

  // Track position count for "is new" detection
  useEffect(() => {
    prevCountRef.current = positions.length;
  }, [positions.length]);

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

  return (
    <div className="center-content" ref={contentRef}>
      <div className="chat-thread">
        {positions.map((p, idx) => {
          const agentIdx = agentIDs.indexOf(p.agent_id);
          const isLeft = agentIdx % 2 === 0;
          const isNewest = idx === positions.length - 1;
          const isNewlyAdded = idx >= prevCountRef.current;
          const shouldType = isNewest && isNewlyAdded && playing && animationPhase === 'ready';
          const isHighlighted = activeNode === p.agent_id;

          return (
            <div key={p.position_id} ref={(el) => setBubbleRef(idx, el)} className={isHighlighted ? 'chat-bubble-highlighted' : ''}>
              <ChatBubble
                agentId={p.agent_id}
                content={p.content}
                isLeft={isLeft}
                shouldType={shouldType}
                agentNames={agentNames}
                typingSpeed={typingSpeed}
              />
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
