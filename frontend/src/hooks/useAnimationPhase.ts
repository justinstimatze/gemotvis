import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph';
import type { AnimationPhase } from '../types';

const MOVE_DURATION = 800; // ms pause after layout change before showing panel
const FIRST_EDGE_DURATION = 100; // ms for initial edge set (no layout movement)

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
    const isFirst = prevEdge.current == null;
    prevEdge.current = activeEdge;

    if (!activeEdge) {
      setAnimationPhase('idle');
      return;
    }

    setAnimationPhase('moving');
    // First edge activation (from idle): no layout movement, show panel quickly.
    // Subsequent changes: nodes need time to animate to new positions.
    const duration = isFirst ? FIRST_EDGE_DURATION : MOVE_DURATION;
    const timer = setTimeout(() => setAnimationPhase('ready'), duration);
    return () => clearTimeout(timer);
  }, [activeEdge, setAnimationPhase]);

  return animationPhase;
}
