import { useMemo } from 'react';
import { useSessionStore } from '../stores/session';
import { useScrubberStore } from '../stores/scrubber';
import { useGraphStore } from '../stores/graph';
import { filterToTime } from '../lib/filterToTime';
import type { DelibState } from '../types';

/**
 * Returns deliberation state filtered to the current scrubber position.
 * For the focused delib: event-count based reveal.
 * For background delibs: timestamp based reveal.
 */
export function useFilteredState(): Record<string, DelibState> {
  const deliberations = useSessionStore((s) => s.deliberations);
  const scrubberEnabled = useScrubberStore((s) => s.enabled);
  const scrubberEventIndex = useScrubberStore((s) => s.eventIndex);
  const scrubberEvents = useScrubberStore((s) => s.events);
  const activeEdge = useGraphStore((s) => s.activeEdge);

  return useMemo(() => {
    // Skip filtering for live views (dashboard, watch, group) — show all data immediately
    const isLive = window.location.pathname.startsWith('/dashboard') ||
                   window.location.pathname.startsWith('/watch/') ||
                   window.location.pathname.startsWith('/g/');
    if (isLive || !scrubberEnabled || scrubberEventIndex == null) return deliberations;

    const currentEvent = scrubberEvents[scrubberEventIndex];
    const cutoffTime = currentEvent?.time ?? null;
    const focusedDelibID = activeEdge;

    const ctx = {
      focusedDelibID,
      scrubberEnabled,
      scrubberEventIndex,
      scrubberEvents,
    };

    const filtered: Record<string, DelibState> = {};
    for (const [id, ds] of Object.entries(deliberations)) {
      filtered[id] = filterToTime(ds, cutoffTime, ctx);
    }
    return filtered;
  }, [deliberations, scrubberEnabled, scrubberEventIndex, scrubberEvents, activeEdge]);
}
