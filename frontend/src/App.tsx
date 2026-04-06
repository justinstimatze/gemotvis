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
import { ScrubberBar } from './components/scrubber/ScrubberBar';
import { Footer } from './components/panels/Footer';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { BootOverlay } from './components/BootOverlay';
import { useEffect, useRef, useState } from 'react';

// Expose stores for debugging
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
  useScrubberPlayback();

  useEffect(() => {
    const ids = Object.keys(deliberations);
    if (ids.length === 0) return;
    const events = buildGlobalTimeline(deliberations);
    setEvents(events);
  }, [deliberations, setEvents]);

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
        setTimeout(() => useScrubberStore.getState().setPlaying(true), 50);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <GraphCanvas />
      <Footer />
      <ScrubberBar />
    </>
  );
}

function isDemo(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('demo') || params.has('multi');
}

function isWatchPath(): boolean {
  return window.location.pathname.startsWith('/watch/');
}

export function App() {
  const theme = useThemeStore((s) => s.activeTheme);
  const [bootDone, setBootDone] = useState(false);
  const showDemo = isDemo() || isWatchPath();

  useSSE();

  // Skip boot for landing page
  if (!showDemo && !bootDone) {
    return (
      <div id="screen" className={`theme-${theme}`} style={{ width: '100vw', height: '100vh' }}>
        <LandingPage />
      </div>
    );
  }

  return (
    <div id="screen" className={`theme-${theme}`} style={{ width: '100vw', height: '100vh' }}>
      {!bootDone && <BootOverlay onComplete={() => setBootDone(true)} />}
      <Header />
      <ReactFlowProvider>
        <Routes>
          <Route path="/*" element={<GraphView />} />
        </Routes>
      </ReactFlowProvider>
    </div>
  );
}
