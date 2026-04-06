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

const VALID_THEMES = ['magi', 'minimal', 'gastown'] as const;

function getTheme(): Theme {
  // URL param takes priority
  const params = new URLSearchParams(window.location.search);
  const urlTheme = params.get('theme');
  if (urlTheme && VALID_THEMES.includes(urlTheme as Theme)) return urlTheme as Theme;

  // Then cookie
  const match = document.cookie.match(/(?:^|; )gemotvis_theme=(\w+)/);
  if (match && VALID_THEMES.includes(match[1] as Theme)) return match[1] as Theme;

  return 'minimal';
}

function saveThemeCookie(theme: Theme) {
  document.cookie = `gemotvis_theme=${theme}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = getTheme();
  saveThemeCookie(initial);
  return {
    activeTheme: initial,
    voteLabels: VOTE_LABELS[initial],
    statusLabels: STATUS_LABELS[initial],
    setTheme: (theme) => {
      saveThemeCookie(theme);
      set({
        activeTheme: theme,
        voteLabels: VOTE_LABELS[theme],
        statusLabels: STATUS_LABELS[theme],
      });
    },
  };
});
