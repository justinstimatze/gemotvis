import { useEffect, useRef, useCallback } from 'react';
import { useScrubberStore } from '../stores/scrubber';
import { useGraphStore } from '../stores/graph';

/**
 * Autoplay loop: advances through timeline events at configurable speed.
 * Handles edge-switch detection, skipping non-visual events, and looping.
 */
export function useScrubberPlayback() {
  const playing = useScrubberStore((s) => s.playing);
  const setEventIndex = useScrubberStore((s) => s.setEventIndex);
  const setPlaying = useScrubberStore((s) => s.setPlaying);
  const setActiveEdge = useGraphStore((s) => s.setActiveEdge);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    const state = useScrubberStore.getState();
    const { events: evts, eventIndex: idx } = state;
    if (idx == null || !state.playing) return;

    // Wait for typing animation to finish before advancing
    const speakingAgent = useGraphStore.getState().speakingAgent;
    if (speakingAgent) {
      // Re-check in 200ms
      timerRef.current = setTimeout(advance, 200);
      return;
    }

    let next = idx + 1;

    // Find next visual event (position or vote)
    while (next < evts.length) {
      const evt = evts[next];
      if (evt && (evt.type === 'position' || evt.type === 'vote' || evt.type === 'analysis')) break;
      next++;
    }

    if (next >= evts.length) {
      // End of timeline — stop
      setPlaying(false);
      return;
    }

    const currentEvt = evts[idx];
    const nextEvt = evts[next];

    // Update active edge if the delib changed
    if (nextEvt && nextEvt.delibID !== currentEvt?.delibID) {
      setActiveEdge(nextEvt.delibID);
    }

    setEventIndex(next);

    // Schedule next advance with speed-dependent delay
    const edgeSwitched = nextEvt && currentEvt && nextEvt.delibID !== currentEvt.delibID;
    const delay = edgeSwitched ? state.speed * 1.5 : state.speed;
    timerRef.current = setTimeout(advance, delay);
  }, [setEventIndex, setPlaying, setActiveEdge]);

  // Start/stop playback
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    // Kick off first advance after a short delay
    timerRef.current = setTimeout(advance, 100);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playing, advance]);

  const startPlayback = useCallback(() => {
    const state = useScrubberStore.getState();
    if (state.events.length < 2) return;

    if (state.eventIndex == null) {
      setEventIndex(0);
    }
    // Set active edge to the first event's delib
    const firstEvt = state.events[state.eventIndex ?? 0];
    if (firstEvt) setActiveEdge(firstEvt.delibID);

    setPlaying(true);
  }, [setEventIndex, setPlaying, setActiveEdge]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
  }, [setPlaying]);

  const skipForward = useCallback(() => {
    const state = useScrubberStore.getState();
    const { events: evts, eventIndex: idx } = state;
    if (idx == null || evts.length === 0) return;

    const currentDelibID = evts[idx]?.delibID;
    // Find next event from a different delib
    let next = idx + 1;
    while (next < evts.length && evts[next]?.delibID === currentDelibID) next++;

    if (next < evts.length) {
      const nextEvt = evts[next]!;
      setActiveEdge(nextEvt.delibID);
      setEventIndex(next);
    }
  }, [setEventIndex, setActiveEdge]);

  return { startPlayback, stopPlayback, skipForward };
}

/** Standalone action: start playback (for use outside the hook). */
export function startPlaybackAction() {
  const state = useScrubberStore.getState();
  if (state.events.length < 2) return;

  if (state.eventIndex == null) {
    state.setEventIndex(0);
  }
  const firstEvt = state.events[state.eventIndex ?? 0];
  if (firstEvt) useGraphStore.getState().setActiveEdge(firstEvt.delibID);

  state.setPlaying(true);
}

/** Standalone action: stop playback (for use outside the hook). */
export function stopPlaybackAction() {
  useScrubberStore.getState().setPlaying(false);
}

/** Standalone action: skip to next deliberation (for use outside the hook). */
export function skipForwardAction() {
  const state = useScrubberStore.getState();
  const { events: evts, eventIndex: idx } = state;
  if (idx == null || evts.length === 0) return;

  const currentDelibID = evts[idx]?.delibID;
  let next = idx + 1;
  while (next < evts.length && evts[next]?.delibID === currentDelibID) next++;

  if (next < evts.length) {
    const nextEvt = evts[next]!;
    useGraphStore.getState().setActiveEdge(nextEvt.delibID);
    state.setEventIndex(next);
  }
}
