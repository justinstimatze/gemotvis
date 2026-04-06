import { Routes, Route, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useThemeStore } from './stores/theme';
import { useSSE } from './hooks/useSSE';
import { useWatchSSE } from './hooks/useWatchSSE';
import { useSessionStore } from './stores/session';
import { useScrubberStore } from './stores/scrubber';
import { useGraphStore } from './stores/graph';
import { useScrubberPlayback } from './hooks/useScrubberPlayback';
import { buildGlobalTimeline } from './lib/buildTimeline';
import { GraphCanvas } from './components/graph/GraphCanvas';
import { Footer } from './components/panels/Footer';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { BootOverlay } from './components/BootOverlay';
import { LoginForm } from './components/auth/LoginForm';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

// Debug: expose stores on window (only in dev)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__session = useSessionStore;
  w.__scrubber = useScrubberStore;
  w.__graph = useGraphStore;
  w.__theme = useThemeStore;
}

/** Shared graph view with autoplay — used by both demo and watch modes. */
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
    </>
  );
}

/** Demo mode: connect to default SSE endpoints. */
function DemoMode() {
  useSSE();
  return <GraphView />;
}

/** Watch mode: connect to watch SSE endpoints for join code(s). */
function WatchMode() {
  const { code } = useParams<{ code: string }>();
  const params = new URLSearchParams(window.location.search);
  const alsoCodes = params.get('also')?.split(',').filter(Boolean) ?? [];

  const codes = useMemo(() => {
    const all = code ? [code, ...alsoCodes] : alsoCodes;
    return [...new Set(all)]; // deduplicate
  }, [code, alsoCodes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useWatchSSE(codes);

  return (
    <>
      {code && (
        <div className="watch-badge">
          WATCHING: {codes.join(', ')}
        </div>
      )}
      <GraphView />
    </>
  );
}

/** Dashboard mode: login with API key, then view all deliberations. */
function DashboardMode() {
  const [loggedIn, setLoggedIn] = useState(false);

  const handleLogin = useCallback(() => {
    setLoggedIn(true);
  }, []);

  if (!loggedIn) {
    return <LoginForm onLogin={handleLogin} />;
  }

  // After login, use dashboard SSE endpoints
  return <DashboardView />;
}

function DashboardView() {
  useSSE({
    stateURL: '/api/dashboard/state',
    eventsURL: '/api/dashboard/events',
  });
  return <GraphView />;
}

function isDemo(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('demo') || params.has('multi');
}

function isWatchPath(): boolean {
  return window.location.pathname.startsWith('/watch/');
}

function isDashboardPath(): boolean {
  return window.location.pathname.startsWith('/dashboard');
}

export function App() {
  const theme = useThemeStore((s) => s.activeTheme);
  const [bootDone, setBootDone] = useState(false);
  const showApp = isDemo() || isWatchPath() || isDashboardPath();
  useKeyboardShortcuts();

  // Show landing page if not demo/watch/dashboard
  if (!showApp && !bootDone) {
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
          <Route path="/watch/:code" element={<WatchMode />} />
          <Route path="/dashboard" element={<DashboardMode />} />
          <Route path="/*" element={<DemoMode />} />
        </Routes>
      </ReactFlowProvider>
    </div>
  );
}
