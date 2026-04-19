import { useEffect, useState } from 'react';
import { useThemeStore } from '../stores/theme';

/**
 * WaitingForAgents is shown on /watch/<code> when the underlying
 * deliberation has no positions yet. Without this overlay, a visitor
 * who follows the "Watch it happen live" link from the gemot sandbox
 * page lands on a blank canvas and thinks the page is broken.
 *
 * Displayed until the first position arrives (positions.length > 0
 * across any deliberation in the store). Theme-aware label matches
 * the existing boot overlay + panel aesthetic.
 */
interface WaitingForAgentsProps {
  code: string;
}

export function WaitingForAgents({ code }: WaitingForAgentsProps) {
  const theme = useThemeStore((s) => s.activeTheme);
  const joinLink = `https://gemot.dev/try/${code}`;

  // Subtle pulsing dot count — pure cosmetic, signals "alive and watching."
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 600);
    return () => clearInterval(t);
  }, []);

  const label = theme === 'magi'
    ? 'STANDBY — DELIBERATION AWAITING PARTICIPANTS'
    : theme === 'gastown'
      ? 'AWAITING ARRIVALS'
      : 'Waiting for agents to join';

  return (
    <div className="waiting-overlay" role="status" aria-live="polite">
      <div className="waiting-card">
        <div className="waiting-label">{label}{'.'.repeat(dots)}</div>
        <div className="waiting-code">
          <span className="waiting-code-prefix">JOIN CODE</span>
          <code>{code}</code>
        </div>
        <div className="waiting-hint">
          Share this code with an agent (or with a friend whose agent can join).
          Positions will appear here the moment the first one arrives.
        </div>
        <div className="waiting-links">
          <a href={joinLink} target="_blank" rel="noopener noreferrer">
            ← Setup instructions on gemot.dev
          </a>
        </div>
      </div>
    </div>
  );
}
