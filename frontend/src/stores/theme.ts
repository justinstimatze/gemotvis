import { create } from 'zustand';
import type { Theme } from '../types';

const VOTE_LABELS = {
  magi: { 1: '\u627F\u8A8D', '-1': '\u5426\u5B9A', 0: '\u4FDD\u7559' } as Record<string, string>,
  minimal: { 1: 'YES', '-1': 'NO', 0: '\u2014' } as Record<string, string>,
  gastown: { 1: 'YES', '-1': 'NO', 0: '\u2014' } as Record<string, string>,
};

const STATUS_LABELS = {
  magi: { online: 'ONLINE', offline: 'OFFLINE', closed: 'CLOSED', analyzing: 'ANALYZING' },
  minimal: { online: 'Connected', offline: 'Disconnected', closed: 'Closed', analyzing: 'Analyzing' },
  gastown: { online: 'OPERATIONAL', offline: 'OFFLINE', closed: 'SEALED', analyzing: 'PROCESSING' },
};

interface ThemeState {
  activeTheme: Theme;
  voteLabels: Record<string, string>;
  statusLabels: { online: string; offline: string; closed: string; analyzing: string };
  setTheme: (theme: Theme) => void;
}

function getThemeFromURL(): Theme {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('theme');
  if (t === 'magi' || t === 'minimal' || t === 'gastown') return t;
  return 'minimal';
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = getThemeFromURL();
  return {
    activeTheme: initial,
    voteLabels: VOTE_LABELS[initial],
    statusLabels: STATUS_LABELS[initial],
    setTheme: (theme) =>
      set({
        activeTheme: theme,
        voteLabels: VOTE_LABELS[theme],
        statusLabels: STATUS_LABELS[theme],
      }),
  };
});
