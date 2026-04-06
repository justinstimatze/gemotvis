import { useState, useCallback, useEffect } from 'react';
import { useThemeStore } from '../stores/theme';
import type { Theme } from '../types';

export function LandingPage() {
  const theme = useThemeStore((s) => s.activeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [watchCode, setWatchCode] = useState('');
  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('demo');

  // Fetch available datasets
  useEffect(() => {
    fetch('/api/datasets')
      .then((r) => r.json() as Promise<{ datasets: string[]; active: string }>)
      .then((d) => {
        setDatasets(d.datasets);
        if (d.active) setSelectedDataset(d.active);
      })
      .catch(() => {});
  }, []);

  const handleThemeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value as Theme);
  }, [setTheme]);

  const startDemo = useCallback(() => {
    const dataParam = selectedDataset !== 'demo' ? `&data=${selectedDataset}` : '';
    window.location.href = `/?demo=1&multi=true&theme=${theme}${dataParam}`;
  }, [theme, selectedDataset]);

  const watchLive = useCallback(() => {
    if (watchCode.trim()) {
      window.location.href = `/watch/${watchCode.trim()}?theme=${theme}`;
    }
  }, [watchCode, theme]);

  return (
    <div className="landing-overlay">
      <div className="landing-content">
        <h1 className="landing-title">gemotvis</h1>
        <p className="landing-subtitle">Deliberation visualization</p>

        <div className="landing-section">
          <label className="landing-label">Theme</label>
          <select className="landing-select" value={theme} onChange={handleThemeChange}>
            <option value="minimal">Minimal</option>
            <option value="magi">MAGI</option>
            <option value="gastown">Gastown</option>
          </select>
        </div>

        {datasets.length > 1 && (
          <div className="landing-section">
            <label className="landing-label">Dataset</label>
            <select
              className="landing-select"
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
            >
              {datasets.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        <div className="landing-section">
          <button className="landing-btn landing-btn-primary" onClick={startDemo}>
            Start Demo
          </button>
        </div>

        <div className="landing-divider" />

        <div className="landing-section">
          <label className="landing-label">Watch a live deliberation</label>
          <div className="landing-row">
            <input
              className="landing-input"
              type="text"
              placeholder="Enter join code"
              value={watchCode}
              onChange={(e) => setWatchCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && watchLive()}
            />
            <button className="landing-btn" onClick={watchLive} disabled={!watchCode.trim()}>
              Watch
            </button>
          </div>
        </div>

        <div className="landing-divider" />

        <div className="landing-links">
          <a href="/dashboard" className="landing-link">Agent Dashboard</a>
          <a href="https://gemot.dev" className="landing-link" target="_blank" rel="noopener">
            gemot.dev
          </a>
        </div>
      </div>
    </div>
  );
}
