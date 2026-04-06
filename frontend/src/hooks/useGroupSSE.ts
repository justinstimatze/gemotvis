import { useEffect } from 'react';
import { useSessionStore } from '../stores/session';
import type { Snapshot, DelibState } from '../types';

/** Connect to group mode SSE endpoints for a group ID. */
export function useGroupSSE(groupId: string) {
  const setDeliberations = useSessionStore((s) => s.setDeliberations);
  const upsertDelib = useSessionStore((s) => s.upsertDelib);
  const setConnected = useSessionStore((s) => s.setConnected);

  // Fetch initial state
  useEffect(() => {
    fetch(`/api/g/${groupId}/state`)
      .then((r) => {
        if (!r.ok) throw new Error(`Group ${groupId}: ${r.status}`);
        return r.json() as Promise<Snapshot>;
      })
      .then((snap) => setDeliberations(snap.deliberations))
      .catch((err) => console.error(`[group] ${groupId}:`, err));
  }, [groupId, setDeliberations]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`/api/g/${groupId}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as
          | { type: 'snapshot'; data: Snapshot }
          | { type: 'state'; data: DelibState }
          | { type: 'ping' };

        switch (msg.type) {
          case 'snapshot':
            setDeliberations(msg.data.deliberations);
            break;
          case 'state': {
            const ds = msg.data;
            const id = ds.deliberation?.deliberation_id;
            if (id) upsertDelib(id, ds);
            break;
          }
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [groupId, setDeliberations, upsertDelib, setConnected]);
}
