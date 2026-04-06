import { useState, useEffect } from 'react';
import { useThemeStore } from '../stores/theme';

const BOOT_TEXT: Record<string, string[]> = {
  minimal: ['gemotvis', 'connecting...'],
  magi: [
    'NERV SYSTEM BOOT SEQUENCE',
    'MAGI-01 MELCHIOR ............ ONLINE',
    'MAGI-02 BALTHASAR ........... ONLINE',
    'MAGI-03 CASPER .............. ONLINE',
    'PATTERN ANALYSIS: STANDBY',
    'DELIBERATION MONITOR: ACTIVE',
  ],
  gastown: [
    'GASTOWN DISPATCH',
    'SIGNAL RELAY .... NOMINAL',
    'PRESSURE GAUGE .. STABLE',
    'CONSENSUS ENGINE  WARMING',
    'ALL STATIONS OPERATIONAL',
  ],
};

interface BootOverlayProps {
  onComplete: () => void;
}

export function BootOverlay({ onComplete }: BootOverlayProps) {
  const theme = useThemeStore((s) => s.activeTheme);
  const [lineIndex, setLineIndex] = useState(0);
  const lines = BOOT_TEXT[theme] ?? BOOT_TEXT.minimal!;

  useEffect(() => {
    if (lineIndex >= lines.length) {
      const timer = setTimeout(onComplete, 800);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => setLineIndex((i) => i + 1),
      theme === 'magi' ? 300 : 500,
    );
    return () => clearTimeout(timer);
  }, [lineIndex, lines.length, onComplete, theme]);

  return (
    <div className={`boot-overlay boot-${theme}`}>
      <div className="boot-text">
        {lines.slice(0, lineIndex).map((line, i) => (
          <div key={i} className="boot-line">{line}</div>
        ))}
        {lineIndex < lines.length && <span className="boot-cursor">_</span>}
      </div>
    </div>
  );
}
