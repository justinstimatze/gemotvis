import { useSessionStore } from '../stores/session';
import { useThemeStore } from '../stores/theme';
import { useFocusedDelib } from '../hooks/useFocusedDelib';
import { isLiveRoute } from '../lib/helpers';
import type { Theme } from '../types';

function ViewToggle() {
  const viewMode = useSessionStore((s) => s.viewMode);
  const setViewMode = useSessionStore((s) => s.setViewMode);
  return (
    <button className="header-view-toggle" onClick={() => setViewMode(viewMode === 'report' ? 'graph' : 'report')} aria-label="Toggle report view">
      {viewMode === 'report' ? 'Graph' : 'Report'}
    </button>
  );
}

function getRouteMode(): 'demo' | 'live' | 'replay' {
  if (isLiveRoute()) return 'live';
  return 'demo';
}

export function Header() {
  const connected = useSessionStore((s) => s.connected);
  const theme = useThemeStore((s) => s.activeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { ds } = useFocusedDelib();
  const topic = ds?.deliberation?.topic ?? '';
  const status = ds?.deliberation?.status ?? '';

  const mode = getRouteMode();
  const statusLabels = useThemeStore((s) => s.statusLabels);
  const statusText = mode === 'demo' ? 'Demo'
    : mode === 'replay' ? 'Replay'
    : connected
      ? (status === 'analyzing' ? statusLabels.analyzing : statusLabels.online)
      : statusLabels.offline;

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTheme = e.target.value as Theme;
    setTheme(newTheme);
    // Update URL param
    const url = new URL(window.location.href);
    url.searchParams.set('theme', newTheme);
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <header className="app-header" id="header">
      <div className="header-left">
        <span className="header-system">GEMOT</span>
        <span className={`header-status ${connected ? 'online' : 'offline'}`}>
          {statusText}
        </span>
      </div>

      <div className="header-center">
        {topic && <span className="header-topic">{topic}</span>}
        {!topic && <span className="header-topic">gemotvis</span>}
      </div>

      <div className="header-right">
        <ViewToggle />
        <span className="header-mode">{mode}</span>
        <select
          className="theme-switcher"
          id="theme-switcher"
          value={theme}
          onChange={handleThemeChange}
          aria-label="Select visual theme"
        >
          <option value="minimal">Minimal</option>
          <option value="gastown">Gastown</option>
          {theme === 'magi' && <option value="magi">MAGI</option>}
        </select>
      </div>
    </header>
  );
}
