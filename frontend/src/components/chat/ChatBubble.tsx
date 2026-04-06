import { memo } from 'react';
import { shortAgentID, splitMentions } from '../../lib/helpers';
import { TypeReveal } from './TypeReveal';

interface ChatBubbleProps {
  agentId: string;
  content: string;
  isLeft: boolean;
  shouldType: boolean;
  agentNames: string[];
  typingSpeed: number;
  agentColor?: string;
  onTypingComplete?: () => void;
}

function RichText({ text, agentNames }: { text: string; agentNames: string[] }) {
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return (
      <>
        {paragraphs.map((para, i) => {
          if (!para.trim()) return null;
          const segments = splitMentions(para.trim(), agentNames);
          return (
            <p key={i} className="chat-para">
              {segments.map((seg, j) =>
                seg.isMention ? (
                  <strong key={j} className="agent-mention">{seg.text}</strong>
                ) : (
                  <span key={j}>{seg.text}</span>
                )
              )}
            </p>
          );
        })}
      </>
    );
  }
  const segments = splitMentions(text, agentNames);
  return (
    <>
      {segments.map((seg, i) =>
        seg.isMention ? (
          <strong key={i} className="agent-mention">{seg.text}</strong>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

function ChatBubbleComponent({
  agentId,
  content,
  isLeft,
  shouldType,
  agentNames,
  typingSpeed,
  agentColor,
  onTypingComplete,
}: ChatBubbleProps) {
  const name = shortAgentID(agentId);

  return (
    <div
      className={`chat-bubble ${isLeft ? 'chat-left' : 'chat-right'} ${shouldType ? 'chat-new' : ''}`}
      style={agentColor ? { borderLeftColor: agentColor, borderLeftWidth: 3, borderLeftStyle: 'solid' } : undefined}
    >
      <div className="chat-name" style={agentColor ? { color: agentColor } : undefined}>{name}</div>
      <div className="chat-text">
        {shouldType ? (
          <TypeReveal
            text={content}
            agentNames={agentNames}
            speed={typingSpeed}
            onComplete={onTypingComplete}
          />
        ) : (
          <RichText text={content} agentNames={agentNames} />
        )}
      </div>
    </div>
  );
}

export const ChatBubble = memo(ChatBubbleComponent);
