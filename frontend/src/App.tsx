import { Routes, Route } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useThemeStore } from './stores/theme';
import { useSSE } from './hooks/useSSE';
import { useSessionStore } from './stores/session';
import { useScrubberStore } from './stores/scrubber';
import { useGraphStore } from './stores/graph';
import { useScrubberPlayback } from './hooks/useScrubberPlayback';
import { buildGlobalTimeline } from './lib/buildTimeline';
import { GraphCanvas } from './components/graph/GraphCanvas';
import { useEffect, useRef } from 'react';

// Expose stores for debugging (remove in production)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__session = useSessionStore;
  w.__scrubber = useScrubberStore;
  w.__graph = useGraphStore;
  w.__theme = useThemeStore;
}

function GraphView() {
  const deliberations = useSessionStore((s) => s.deliberations);
  const setEvents = useScrubberStore((s) => s.setEvents);
  useScrubberPlayback(); // activates the playback effect

  // Build timeline when deliberations change
  useEffect(() => {
    const ids = Object.keys(deliberations);
    if (ids.length === 0) return;
    const events = buildGlobalTimeline(deliberations);
    setEvents(events);
  }, [deliberations, setEvents]);

  // Auto-start playback: poll until events are ready, then start once
  const autoplayRef = useRef(false);
  useEffect(() => {
    if (autoplayRef.current) return;
    const interval = setInterval(() => {
      const state = useScrubberStore.getState();
      if (state.events.length < 2 || autoplayRef.current) return;
      autoplayRef.current = true;
      clearInterval(interval);
      const firstEvt = state.events[0];
      if (firstEvt) {
        state.setEventIndex(0);
        useGraphStore.getState().setActiveEdge(firstEvt.delibID);
        // Small delay so the edge change triggers useAnimationPhase
        setTimeout(() => useScrubberStore.getState().setPlaying(true), 50);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return <GraphCanvas />;
}

export function App() {
  const theme = useThemeStore((s) => s.activeTheme);
  useSSE();

  return (
    <div id="screen" className={`theme-${theme}`} style={{ width: '100vw', height: '100vh' }}>
      <ReactFlowProvider>
        <Routes>
          <Route path="/*" element={<GraphView />} />
        </Routes>
      </ReactFlowProvider>
    </div>
  );
}
