import { useState, useEffect, useMemo } from 'react';
import { splitMentions } from '../../lib/helpers';

interface TypeRevealProps {
  text: string;
  agentNames: string[];
  speed: number; // ms per line
  onComplete?: () => void;
}

/** Render inline markdown: **bold** and agent mentions */
function InlineReveal({ text, agentNames }: { text: string; agentNames: string[] }) {
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

/** Line-by-line typing reveal with markdown rendering. */
export function TypeReveal({ text, agentNames, speed, onComplete }: TypeRevealProps) {
  const lines = useMemo(() => text.split('\n').filter(l => l.trim()), [text]);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= lines.length) {
      onComplete?.();
      return;
    }
    // Speed scales: shorter lines appear faster
    const lineLen = lines[shown]?.length ?? 40;
    const delay = Math.max(speed * 0.5, speed * Math.min(lineLen / 60, 2));
    const timer = setTimeout(() => setShown((s) => s + 1), delay);
    return () => clearTimeout(timer);
  }, [shown, lines.length, lines, speed, onComplete]);

  const visibleLines = lines.slice(0, shown);

  return (
    <div className="type-reveal">
      {visibleLines.map((line, i) => {
        const trimmed = line.trim();

        // Header
        const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
        if (headerMatch) {
          const Tag = `h${headerMatch[1]!.length + 2}` as 'h3' | 'h4' | 'h5';
          return <Tag key={i} className="chat-md-heading"><InlineReveal text={headerMatch[2]!} agentNames={agentNames} /></Tag>;
        }

        // HR
        if (/^[-=]{3,}\s*$/.test(trimmed)) {
          return <hr key={i} className="chat-md-hr" />;
        }

        // Bullet
        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <div key={i} className="chat-md-bullet">
              <span className="chat-md-bullet-dot">•</span>
              <InlineReveal text={trimmed.replace(/^[-*]\s+/, '')} agentNames={agentNames} />
            </div>
          );
        }

        // Paragraph
        return (
          <p key={i} className="chat-para">
            <InlineReveal text={trimmed} agentNames={agentNames} />
          </p>
        );
      })}
      {shown < lines.length && <span className="type-cursor">▊</span>}
    </div>
  );
}
