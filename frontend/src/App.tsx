import { Routes, Route } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useThemeStore } from './stores/theme';
import { useSSE } from './hooks/useSSE';
import { useSessionStore } from './stores/session';
import { useScrubberStore } from './stores/scrubber';
import { useScrubberPlayback } from './hooks/useScrubberPlayback';
import { buildGlobalTimeline } from './lib/buildTimeline';
import { GraphCanvas } from './components/graph/GraphCanvas';
import { useEffect } from 'react';

function GraphView() {
  const deliberations = useSessionStore((s) => s.deliberations);
  const setEvents = useScrubberStore((s) => s.setEvents);
  const autoplayStarted = useScrubberStore((s) => s.autoplayStarted);
  const setAutoplayStarted = useScrubberStore((s) => s.setAutoplayStarted);
  const { startPlayback } = useScrubberPlayback();

  // Build timeline when deliberations change
  useEffect(() => {
    const ids = Object.keys(deliberations);
    if (ids.length === 0) return;
    const events = buildGlobalTimeline(deliberations);
    setEvents(events);
  }, [deliberations, setEvents]);

  // Auto-start playback once we have events
  const events = useScrubberStore((s) => s.events);
  useEffect(() => {
    if (autoplayStarted || events.length < 2) return;
    setAutoplayStarted(true);
    const timer = setTimeout(() => startPlayback(), 1000);
    return () => clearTimeout(timer);
  }, [events, autoplayStarted, setAutoplayStarted, startPlayback]);

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
