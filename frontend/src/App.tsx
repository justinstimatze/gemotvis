import { Routes, Route, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useThemeStore } from './stores/theme';
import { useSSE } from './hooks/useSSE';
import { useWatchSSE } from './hooks/useWatchSSE';
import { WaitingForAgents } from './components/WaitingForAgents';
import { useGroupSSE } from './hooks/useGroupSSE';
import { useSessionStore } from './stores/session';
import { useScrubberStore } from './stores/scrubber';
import { useGraphStore } from './stores/graph';
import { useScrubberPlayback } from './hooks/useScrubberPlayback';
import { buildGlobalTimeline } from './lib/buildTimeline';
import { GraphCanvas } from './components/graph/GraphCanvas';
import { Footer } from './components/panels/Footer';
import { ReportView } from './components/report/ReportView';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { BootOverlay } from './components/BootOverlay';
import { LoginForm } from './components/auth/LoginForm';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useURLSync } from './hooks/useURLSync';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { getPositionCount } from './lib/helpers';

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

  // Build a fingerprint of deliberation data to avoid rebuilding timeline on every SSE message.
  // Only rebuild when the number of deliberations, positions, votes, or analyses change.
  const timelineFingerprint = useMemo(() => {
    const ids = Object.keys(deliberations).sort();
    if (ids.length === 0) return '';
    const parts = ids.map((id) => {
      const ds = deliberations[id]!;
      const pc = getPositionCount(ds);
      const vc = (ds.votes ?? []).length;
      const ac = ds.analysis ? 1 : 0;
      const oc = (ds.audit_log?.operations ?? []).length;
      return `${id}:${pc}:${vc}:${ac}:${oc}`;
    });
    return parts.join('|');
  }, [deliberations]);

  useEffect(() => {
    if (!timelineFingerprint) return;
    const events = buildGlobalTimeline(deliberations);
    setEvents(events);
  }, [timelineFingerprint, setEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autoplay: set activeEdge first (mounts panel), then start playing once panel is ready.
  // This ensures the first position arrives as a "new" message with typing animation.
  const autoplayRef = useRef(false);
  const animationPhase = useGraphStore((s) => s.animationPhase);

  useEffect(() => {
    if (autoplayRef.current) return;
    const interval = setInterval(() => {
      const state = useScrubberStore.getState();
      if (state.events.length < 2 || autoplayRef.current) return;
      autoplayRef.current = true;
      clearInterval(interval);
      const firstEvt = state.events[0];
      if (firstEvt) {
        // Set activeEdge to trigger panel mount, but DON'T set eventIndex yet
        useGraphStore.getState().setActiveEdge(firstEvt.delibID);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Once panel is ready (phase='ready'), start playback from event 0.
  // Set playing=true FIRST so that when eventIndex changes and the first
  // position renders, the shouldType check sees playing=true.
  const playbackStarted = useRef(false);
  useEffect(() => {
    if (!autoplayRef.current || playbackStarted.current) return;
    if (animationPhase !== 'ready') return;
    playbackStarted.current = true;
    useScrubberStore.getState().setPlaying(true);
    // Next frame: set eventIndex so position appears while playing is already true
    requestAnimationFrame(() => useScrubberStore.getState().setEventIndex(0));
  }, [animationPhase]);

  const hasData = Object.keys(deliberations).length > 0;

  if (!hasData) {
    return (
      <div className="loading-skeleton">
        <div className="loading-pulse" />
        <div className="loading-text">Waiting for deliberation data...</div>
      </div>
    );
  }

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
  const viewMode = useSessionStore((s) => s.viewMode);
  if (viewMode === 'report') return <ReportView />;
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

  useEffect(() => { useSessionStore.setState({ mode: 'live' }); }, []);

  const viewMode = useSessionStore((s) => s.viewMode);
  // Empty-state detection: when zero positions exist across every
  // deliberation being watched, the canvas is blank — a visitor who
  // just clicked "Watch it happen live" from the sandbox sees
  // nothing. Show a WaitingForAgents overlay until the first
  // position arrives. Only triggers on single-code watches (the
  // common /try/<code> flow); multi-code ?also= watches keep the
  // existing behavior.
  const hasAnyPosition = useSessionStore((s) =>
    Object.values(s.deliberations).some((d) => d.positions.length > 0)
  );
  const showWaiting = codes.length === 1 && !hasAnyPosition;

  if (viewMode === 'report') return <ReportView />;

  return (
    <>
      {code && (
        <div className="watch-badge">
          WATCHING: {codes.join(', ')}
        </div>
      )}
      <GraphView />
      {showWaiting && code && <WaitingForAgents code={code} />}
    </>
  );
}

/** Group mode: view all deliberations in a group (shared link). */
function GroupMode() {
  const { groupId } = useParams<{ groupId: string }>();
  useGroupSSE(groupId ?? '');

  useEffect(() => { useSessionStore.setState({ mode: 'live' }); }, []);

  return (
    <>
      {groupId && <div className="watch-badge">GROUP: {groupId}</div>}
      <GraphView />
    </>
  );
}

/** Dashboard mode: login with API key, then view all deliberations. */
function DashboardMode() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null); // null = checking

  // Check for existing session on mount
  useEffect(() => {
    fetch('/api/dashboard/state')
      .then((r) => {
        if (r.ok) setLoggedIn(true);
        else setLoggedIn(false);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const handleLogin = useCallback(() => {
    setLoggedIn(true);
  }, []);

  if (loggedIn === null) return null; // checking session
  if (!loggedIn) return <LoginForm onLogin={handleLogin} />;

  return <DashboardView />;
}

function DashboardView() {
  // Override mode to 'live' for dashboard (server may report 'demo')
  useEffect(() => {
    useSessionStore.getState().setConnected(true);
    useSessionStore.setState({ mode: 'live' });
  }, []);

  useSSE({
    stateURL: '/api/dashboard/state',
    eventsURL: '/api/dashboard/events',
  });
  return <GraphView />;
}

function isDemo(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('demo') || params.has('multi') || params.has('data') || params.has('view');
}

function isWatchPath(): boolean {
  return window.location.pathname.startsWith('/watch/');
}

function isGroupPath(): boolean {
  return window.location.pathname.startsWith('/g/');
}

function isDashboardPath(): boolean {
  return window.location.pathname.startsWith('/dashboard');
}

export function App() {
  const theme = useThemeStore((s) => s.activeTheme);
  const [bootDone, setBootDone] = useState(false);
  const showApp = isDemo() || isWatchPath() || isGroupPath() || isDashboardPath();
  useKeyboardShortcuts();
  useURLSync();

  // Apply theme class to body for portaled elements (scrubber, footer, panels)
  useEffect(() => {
    document.body.className = `theme-${theme}`;
  }, [theme]);

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
          <Route path="/g/:groupId" element={<GroupMode />} />
          <Route path="/dashboard" element={<DashboardMode />} />
          <Route path="/*" element={<DemoMode />} />
        </Routes>
      </ReactFlowProvider>
    </div>
  );
}
