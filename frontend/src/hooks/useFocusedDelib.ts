import { useGraphStore } from '../stores/graph';
import { useFilteredState } from './useFilteredState';
import type { DelibState } from '../types';

export function useFocusedDelib(): { ds: DelibState | null; activeEdge: string | null } {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const filteredDelibs = useFilteredState();
  const ds = activeEdge ? (filteredDelibs[activeEdge] ?? null) : null;
  return { ds, activeEdge };
}
