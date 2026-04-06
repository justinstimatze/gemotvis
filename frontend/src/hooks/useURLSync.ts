import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph';
import { useScrubberStore } from '../stores/scrubber';
import { useSessionStore } from '../stores/session';

/**
 * Sync graph/scrubber state to URL params for shareable links.
 * Params: ?edge=<delibID>&t=<eventIndex>
 *
 * On mount, reads URL params and restores state (after data loads).
 * To update URL manually, call updateURLParams().
 */
export function useURLSync() {
  const initialized = useRef(false);

  // Restore state from URL on first render (delayed to let data load)
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const edge = params.get('edge');
    const t = params.get('t');

    if (!edge && !t) return;

    // Wait for SSE data to load before restoring
    const timer = setTimeout(() => {
      const delibs = useSessionStore.getState().deliberations;
      if (edge && delibs[edge]) {
        useGraphStore.getState().setActiveEdge(edge);
        useScrubberStore.getState().setPlaying(false);
      }
      if (t != null) {
        const idx = parseInt(t, 10);
        const events = useScrubberStore.getState().events;
        if (!isNaN(idx) && idx >= 0 && idx < events.length) {
          useScrubberStore.getState().setEventIndex(idx);
        }
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
}

/** Update URL with current graph state. Call from click/keyboard handlers. */
export function updateURLParams() {
  const url = new URL(window.location.href);
  const activeEdge = useGraphStore.getState().activeEdge;
  const eventIndex = useScrubberStore.getState().eventIndex;

  if (activeEdge) {
    url.searchParams.set('edge', activeEdge);
  } else {
    url.searchParams.delete('edge');
  }

  if (eventIndex != null && eventIndex > 0) {
    url.searchParams.set('t', String(eventIndex));
  } else {
    url.searchParams.delete('t');
  }

  window.history.replaceState({}, '', url.toString());
}
