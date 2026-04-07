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

/** Render inline markdown: **bold**, agent mentions */
function InlineText({ text, agentNames }: { text: string; agentNames: string[] }) {
  // Split on **bold** markers first, then handle mentions within each segment
  const parts: { text: string; bold: boolean }[] = [];
  const boldParts = text.split(/\*\*(.+?)\*\*/g);
  for (let i = 0; i < boldParts.length; i++) {
    if (boldParts[i]) parts.push({ text: boldParts[i]!, bold: i % 2 === 1 });
  }

  return (
    <>
      {parts.map((part, i) => {
        const segments = splitMentions(part.text, agentNames);
        return segments.map((seg, j) => {
          const key = `${i}-${j}`;
          if (seg.isMention) return <strong key={key} className="agent-mention">{seg.text}</strong>;
          if (part.bold) return <strong key={key}>{seg.text}</strong>;
          return <span key={key}>{seg.text}</span>;
        });
      })}
    </>
  );
}

/** Render a block of text as a markdown-aware element */
function MarkdownBlock({ line, agentNames }: { line: string; agentNames: string[] }) {
  const trimmed = line.trim();

  // Headers: # ## ###
  const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
  if (headerMatch) {
    const level = headerMatch[1]!.length;
    const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5'; // h3-h5 to stay reasonable
    return <Tag className="chat-md-heading"><InlineText text={headerMatch[2]!} agentNames={agentNames} /></Tag>;
  }

  // Horizontal rule: --- or ===
  if (/^[-=]{3,}\s*$/.test(trimmed)) {
    return <hr className="chat-md-hr" />;
  }

  // Bullet list item: - text or * text
  if (/^[-*]\s+/.test(trimmed)) {
    return (
      <li className="chat-md-li">
        <InlineText text={trimmed.replace(/^[-*]\s+/, '')} agentNames={agentNames} />
      </li>
    );
  }

  return (
    <p className="chat-para">
      <InlineText text={trimmed} agentNames={agentNames} />
    </p>
  );
}

function RichText({ text, agentNames }: { text: string; agentNames: string[] }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      // Flush list
      if (listItems.length > 0) {
        elements.push(<ul key={`ul-${i}`} className="chat-md-ul">{listItems}</ul>);
        listItems = [];
      }
      continue;
    }

    const isBullet = /^\s*[-*]\s+/.test(line);
    if (isBullet) {
      listItems.push(<MarkdownBlock key={i} line={line} agentNames={agentNames} />);
    } else {
      // Flush list before non-list content
      if (listItems.length > 0) {
        elements.push(<ul key={`ul-${i}`} className="chat-md-ul">{listItems}</ul>);
        listItems = [];
      }
      elements.push(<MarkdownBlock key={i} line={line} agentNames={agentNames} />);
    }
  }

  // Flush trailing list
  if (listItems.length > 0) {
    elements.push(<ul key="ul-end" className="chat-md-ul">{listItems}</ul>);
  }

  return <>{elements}</>;
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
