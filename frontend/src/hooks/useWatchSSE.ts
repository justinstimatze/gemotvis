import { useEffect } from 'react';
import { useSessionStore } from '../stores/session';
import type { Snapshot, DelibState } from '../types';

/**
 * Connect to watch mode SSE endpoints for one or more join codes.
 * Each code gets its own SSE connection; all merge into the same store.
 */
export function useWatchSSE(codes: string[]) {
  const setDeliberations = useSessionStore((s) => s.setDeliberations);
  const upsertDelib = useSessionStore((s) => s.upsertDelib);
  const setConnected = useSessionStore((s) => s.setConnected);

  // Fetch initial state for each code
  useEffect(() => {
    for (const code of codes) {
      fetch(`/api/watch/${code}/state`)
        .then((r) => {
          if (!r.ok) throw new Error(`Watch ${code}: ${r.status}`);
          return r.json() as Promise<Snapshot>;
        })
        .then((snap) => {
          // Merge into existing deliberations
          const store = useSessionStore.getState();
          setDeliberations({ ...store.deliberations, ...snap.deliberations });
        })
        .catch((err) => console.error(`[watch] ${code}:`, err));
    }
  }, [codes.join(','), setDeliberations]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE connections for each code
  useEffect(() => {
    const sources: EventSource[] = [];

    for (const code of codes) {
      const es = new EventSource(`/api/watch/${code}/events`);

      es.onopen = () => setConnected(true);
      es.onerror = () => {
        // Only mark disconnected if ALL sources fail
        if (sources.every((s) => s.readyState === EventSource.CLOSED)) {
          setConnected(false);
        }
      };

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as
            | { type: 'snapshot'; data: Snapshot }
            | { type: 'state'; data: DelibState }
            | { type: 'ping' };

          switch (msg.type) {
            case 'snapshot': {
              const store = useSessionStore.getState();
              setDeliberations({ ...store.deliberations, ...msg.data.deliberations });
              break;
            }
            case 'state': {
              const ds = msg.data;
              const id = ds.deliberation?.deliberation_id;
              if (id) upsertDelib(id, ds);
              break;
            }
          }
        } catch {
          // ignore
        }
      };

      sources.push(es);
    }

    return () => sources.forEach((es) => es.close());
  }, [codes.join(','), setDeliberations, upsertDelib, setConnected]); // eslint-disable-line react-hooks/exhaustive-deps
}
