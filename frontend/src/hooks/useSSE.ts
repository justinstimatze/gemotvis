import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/session';
import { useGraphStore } from '../stores/graph';
import type { Snapshot, DelibState, ServerConfig } from '../types';

interface SSEConfig {
  /** Base URL for SSE events. Defaults to /api/events. */
  eventsURL?: string;
  /** Base URL for initial state fetch. Defaults to /api/state. */
  stateURL?: string;
}

/** Connect to the gemotvis SSE stream and dispatch updates to the session store. */
export function useSSE(config: SSEConfig = {}) {
  const setDeliberations = useSessionStore((s) => s.setDeliberations);
  const upsertDelib = useSessionStore((s) => s.upsertDelib);
  const setConnected = useSessionStore((s) => s.setConnected);
  const setConfig = useSessionStore((s) => s.setConfig);
  const configFetched = useRef(false);

  // Live mode: auto-focus updated bilaterals
  const isLive = window.location.pathname.startsWith('/dashboard') ||
                 window.location.pathname.startsWith('/watch/') ||
                 window.location.pathname.startsWith('/g/');

  // Pass ?data= param from URL to SSE/state endpoints for dataset selection
  const dataParam = new URLSearchParams(window.location.search).get('data');
  const dataSuffix = dataParam ? `?data=${encodeURIComponent(dataParam)}` : '';
  const eventsURL = config.eventsURL ?? `/api/events${dataSuffix}`;
  const stateURL = config.stateURL ?? `/api/state${dataSuffix}`;

  // Fetch server config once
  useEffect(() => {
    if (configFetched.current) return;
    configFetched.current = true;
    fetch('/api/config')
      .then((r) => r.json() as Promise<ServerConfig>)
      .then((cfg) => setConfig(cfg))
      .catch(() => {}); // best-effort
  }, [setConfig]);

  // Fetch initial state — retry if empty (poller may not have completed first poll yet)
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout>;
    let retries = 0;

    function fetchState() {
      fetch(stateURL)
        .then((r) => r.json() as Promise<Snapshot>)
        .then((snap) => {
          const delibs = snap.deliberations ?? {};
          setDeliberations(delibs);
          // Retry if empty and we haven't given up
          if (Object.keys(delibs).length === 0 && retries < 10) {
            retries++;
            retryTimer = setTimeout(fetchState, 3000);
          }
        })
        .catch(() => {
          if (retries < 10) {
            retries++;
            retryTimer = setTimeout(fetchState, 3000);
          }
        });
    }
    fetchState();

    return () => clearTimeout(retryTimer);
  }, [stateURL, setDeliberations]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(eventsURL);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as
          | { type: 'snapshot'; data: Snapshot }
          | { type: 'state'; data: DelibState }
          | { type: 'cycle'; data: { deliberation_id: string } }
          | { type: 'ping' };

        switch (msg.type) {
          case 'snapshot':
            setDeliberations(msg.data.deliberations);
            break;
          case 'state': {
            const ds = msg.data;
            const id = ds.deliberation?.deliberation_id;
            if (id) {
              upsertDelib(id, ds);
              // In live mode, auto-focus the bilateral that just got updated
              if (isLive && (ds.positions?.length ?? 0) > 0) {
                useGraphStore.getState().setActiveEdge(id);
              }
            }
            break;
          }
          // cycle and ping handled elsewhere or ignored
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => es.close();
  }, [eventsURL, setDeliberations, upsertDelib, setConnected]);
}
