import { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graph';
import { useScrubberStore } from '../stores/scrubber';

/**
 * Sync graph/scrubber state to URL params for shareable links.
 * Params: ?edge=<delibID>&t=<eventIndex>
 *
 * On mount, reads URL params and restores state.
 * On state change, updates URL params (debounced).
 */
export function useURLSync() {
  const initialized = useRef(false);

  // Restore state from URL on first render
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const edge = params.get('edge');
    const t = params.get('t');

    if (edge) {
      useGraphStore.getState().setActiveEdge(edge);
    }
    if (t != null) {
      const idx = parseInt(t, 10);
      if (!isNaN(idx) && idx >= 0) {
        // Delay to let events load first
        setTimeout(() => {
          const events = useScrubberStore.getState().events;
          if (idx < events.length) {
            useScrubberStore.getState().setEventIndex(idx);
            useScrubberStore.getState().setPlaying(false);
          }
        }, 2000);
      }
    }
  }, []);

  // Sync state changes to URL (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsubGraph = useGraphStore.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => updateURL(state.activeEdge), 500);
    });

    return () => {
      unsubGraph();
      clearTimeout(timer);
    };
  }, []);
}

function updateURL(activeEdge: string | null) {
  const url = new URL(window.location.href);
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
