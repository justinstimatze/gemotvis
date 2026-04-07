import { create } from 'zustand';
import type { DelibState, ServerConfig } from '../types';

interface SessionState {
  deliberations: Record<string, DelibState>;
  connected: boolean;
  mode: 'demo' | 'replay' | 'live';
  viewMode: 'graph' | 'report';
  cycleInterval: number;
  gemotURL: string;

  setDeliberations: (delibs: Record<string, DelibState>) => void;
  upsertDelib: (id: string, ds: DelibState) => void;
  setConnected: (connected: boolean) => void;
  setConfig: (config: ServerConfig) => void;
  setViewMode: (view: 'graph' | 'report') => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  deliberations: {},
  connected: false,
  mode: 'demo',
  viewMode: new URLSearchParams(window.location.search).get('view') === 'report' ? 'report' : 'graph',
  cycleInterval: 0,
  gemotURL: '',

  setDeliberations: (delibs) => set({ deliberations: delibs }),
  upsertDelib: (id, ds) =>
    set((state) => ({
      deliberations: { ...state.deliberations, [id]: ds },
    })),
  setConnected: (connected) => set({ connected }),
  setConfig: (config) =>
    set({
      mode: config.mode,
      cycleInterval: config.cycle_interval,
      gemotURL: config.gemot_url,
    }),
  setViewMode: (view) => {
    set({ viewMode: view });
    const url = new URL(window.location.href);
    if (view === 'report') url.searchParams.set('view', 'report');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url.toString());
  },
}));
