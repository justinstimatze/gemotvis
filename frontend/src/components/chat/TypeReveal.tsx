import { useState, useEffect, useMemo } from 'react';
import { splitMentions } from '../../lib/helpers';

interface TypeRevealProps {
  text: string;
  agentNames: string[];
  speed: number; // ms per word
  onComplete?: () => void;
}

/** Word-by-word typing reveal with agent name highlighting. */
export function TypeReveal({ text, agentNames, speed, onComplete }: TypeRevealProps) {
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= words.length) {
      onComplete?.();
      return;
    }
    const timer = setTimeout(() => setShown((s) => s + 1), speed);
    return () => clearTimeout(timer);
  }, [shown, words.length, speed, onComplete]);

  const visibleText = words.slice(0, shown).join('');
  const segments = splitMentions(visibleText, agentNames);

  return (
    <span>
      {segments.map((seg, i) =>
        seg.isMention ? (
          <strong key={i} className="agent-mention">{seg.text}</strong>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}
