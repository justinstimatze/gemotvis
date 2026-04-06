import type { Theme } from '../types';

const MAGI_PALETTE = ['#ff8c00', '#00ffff', '#00ff41', '#ff00ff', '#ff2020', '#ffcc00', '#8888ff'];
const GASTOWN_PALETTE = ['#cd9b1d', '#b87333', '#c45a3c', '#4a7c6f', '#8b8682', '#daa520', '#a0522d'];

/** Distinct color for agent index `i` out of `n` total agents. Theme-aware. */
export function agentColor(i: number, n: number, theme: Theme): string {
  if (theme === 'magi') return MAGI_PALETTE[i % MAGI_PALETTE.length]!;
  if (theme === 'gastown') return GASTOWN_PALETTE[i % GASTOWN_PALETTE.length]!;
  const hue = (i * 360 / Math.max(n, 1) + 210) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}
