import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph';
import type { AnimationPhase } from '../types';

const MOVE_DURATION = 800; // ms pause after layout change before showing panel

/**
 * Manages graph animation phase transitions.
 *
 * When activeEdge changes:
 *   idle/ready → 'moving' (nodes animate) → 'ready' (edges + panel visible)
 *
 * When activeEdge clears:
 *   → 'idle'
 *
 * Components consume this to gate their visibility:
 *   - Edges: active class only when 'ready'
 *   - CenterPanel: visible only when 'ready'
 *   - TypeReveal: starts only when 'ready'
 */
export function useAnimationPhase(): AnimationPhase {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const setAnimationPhase = useGraphStore((s) => s.setAnimationPhase);
  const prevEdge = useRef(activeEdge);

  useEffect(() => {
    if (activeEdge === prevEdge.current) return;
    prevEdge.current = activeEdge;

    if (!activeEdge) {
      setAnimationPhase('idle');
      return;
    }

    setAnimationPhase('moving');
    const timer = setTimeout(() => setAnimationPhase('ready'), MOVE_DURATION);
    return () => clearTimeout(timer);
  }, [activeEdge, setAnimationPhase]);

  return animationPhase;
}
