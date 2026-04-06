import { useRef, useEffect, useMemo } from 'react';
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
  const playing = useScrubberStore((s) => s.playing);
  const speed = useScrubberStore((s) => s.speed);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const agentIDs = useMemo(() => agents.map((a) => a.id), [agents]);
  const agentNames = useMemo(() => collectAgentNames(allAgents), [allAgents]);

  // Typing speed: derive from scrubber speed
  const typingSpeed = useMemo(() => {
    // ~60ms per word at 1x, faster at higher speeds
    return Math.max(20, speed / 200);
  }, [speed]);

  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [positions.length]);

  // Track position count for "is new" detection
  useEffect(() => {
    prevCountRef.current = positions.length;
  }, [positions.length]);

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

          return (
            <ChatBubble
              key={p.position_id}
              agentId={p.agent_id}
              content={p.content}
              isLeft={isLeft}
              shouldType={shouldType}
              agentNames={agentNames}
              typingSpeed={typingSpeed}
            />
          );
        })}
      </div>
    </div>
  );
}
