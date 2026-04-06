import { useSessionStore } from '../stores/session';
import { useThemeStore } from '../stores/theme';
import { useGraphStore } from '../stores/graph';
import { useFilteredState } from '../hooks/useFilteredState';
import type { Theme } from '../types';

export function Header() {
  const connected = useSessionStore((s) => s.connected);
  const mode = useSessionStore((s) => s.mode);
  const theme = useThemeStore((s) => s.activeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const filteredDelibs = useFilteredState();

  const ds = activeEdge ? filteredDelibs[activeEdge] : null;
  const topic = ds?.deliberation?.topic ?? '';
  const status = ds?.deliberation?.status ?? '';

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
        <span className="header-mode">{mode}</span>
        <select
          className="theme-switcher"
          id="theme-switcher"
          value={theme}
          onChange={handleThemeChange}
        >
          <option value="minimal">Minimal</option>
          <option value="magi">MAGI</option>
          <option value="gastown">Gastown</option>
        </select>
      </div>
    </header>
  );
}
