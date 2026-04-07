import { useState, useEffect, useMemo } from 'react';
import { splitMentions } from '../../lib/helpers';

interface TypeRevealProps {
  text: string;
  agentNames: string[];
  speed: number; // ms per word
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

/** Render a single line as a markdown element */
function MarkdownLine({ line, agentNames, partial }: { line: string; agentNames: string[]; partial?: string }) {
  const trimmed = line.trim();
  const displayText = partial ?? trimmed;

  // Header
  const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
  if (headerMatch) {
    const Tag = `h${headerMatch[1]!.length + 2}` as 'h3' | 'h4' | 'h5';
    const headerText = partial != null ? partial.replace(/^#{1,3}\s+/, '') : headerMatch[2]!;
    return <Tag className="chat-md-heading"><InlineReveal text={headerText} agentNames={agentNames} /></Tag>;
  }

  // HR
  if (/^[-=]{3,}\s*$/.test(trimmed)) return <hr className="chat-md-hr" />;

  // Bullet
  if (/^[-*]\s+/.test(trimmed)) {
    const bulletText = partial != null ? displayText.replace(/^[-*]\s+/, '') : trimmed.replace(/^[-*]\s+/, '');
    return (
      <div className="chat-md-bullet">
        <span className="chat-md-bullet-dot">•</span>
        <InlineReveal text={bulletText} agentNames={agentNames} />
      </div>
    );
  }

  // Paragraph
  return (
    <p className="chat-para">
      <InlineReveal text={displayText} agentNames={agentNames} />
    </p>
  );
}

/**
 * Progressive typing reveal with markdown rendering.
 * Previous lines render fully; the current line types word-by-word.
 */
export function TypeReveal({ text, agentNames, speed, onComplete }: TypeRevealProps) {
  const lines = useMemo(() => text.split('\n').filter(l => l.trim()), [text]);

  // Flatten all words across all lines, tracking which line each belongs to
  const wordMap = useMemo(() => {
    const map: { lineIdx: number; wordEnd: number }[] = [];
    for (let li = 0; li < lines.length; li++) {
      const words = lines[li]!.split(/(\s+)/);
      for (let wi = 0; wi < words.length; wi++) {
        map.push({ lineIdx: li, wordEnd: wi + 1 });
      }
    }
    return map;
  }, [lines]);

  const [wordIdx, setWordIdx] = useState(0);

  useEffect(() => {
    if (wordIdx >= wordMap.length) {
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => setWordIdx((s) => s + 1), speed);
    return () => clearTimeout(timer);
  }, [wordIdx, wordMap.length, speed, onComplete]);

  // Determine which lines are fully revealed and which is partial
  const currentEntry = wordIdx < wordMap.length ? wordMap[wordIdx] : wordMap[wordMap.length - 1];
  const currentLineIdx = currentEntry?.lineIdx ?? lines.length;

  return (
    <div className="type-reveal">
      {lines.map((line, li) => {
        if (li > currentLineIdx) return null; // not yet revealed

        if (li < currentLineIdx) {
          // Fully revealed line
          return <MarkdownLine key={li} line={line} agentNames={agentNames} />;
        }

        // Current line: show words up to wordEnd, never splitting inside **bold**
        const wordsInLine = line.split(/(\s+)/);
        const wordEnd = currentEntry?.wordEnd ?? 0;
        let partialText = wordsInLine.slice(0, wordEnd).join('');
        // If we're inside an unclosed ** marker, extend to include the closing **
        const openBold = (partialText.match(/\*\*/g) || []).length;
        if (openBold % 2 !== 0) {
          const rest = wordsInLine.slice(wordEnd).join('');
          const closeIdx = rest.indexOf('**');
          if (closeIdx >= 0) partialText += rest.slice(0, closeIdx + 2);
        }

        return (
          <span key={li}>
            <MarkdownLine line={line} agentNames={agentNames} partial={partialText} />
          </span>
        );
      })}
      {wordIdx < wordMap.length && <span className="type-cursor">▊</span>}
    </div>
  );
}
