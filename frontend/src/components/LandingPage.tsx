import { useState, useCallback, useEffect } from 'react';
import { useThemeStore } from '../stores/theme';
import type { Theme } from '../types';

// MAGI theme is an easter egg — available via ?theme=magi but not shown in picker
const themeDescriptions: Record<string, { label: string; desc: string; colors: string[] }> = {
  minimal: { label: 'Minimal', desc: 'Clean and modern', colors: ['#fafafa', '#0070f3', '#333'] },
  gastown: { label: 'Gastown', desc: 'Brass & parchment', colors: ['#f5e6d3', '#b87333', '#5c3a1e'] },
};

const datasetDescriptions: Record<string, string> = {
  'demo-climate-policy': '8 agents — global carbon tax framework',
  'demo-code-review': '3 agents — REST to GraphQL migration review',
  'demo-ethics-board': '3 agents — facial recognition ethics review',
  'gemot-v15a-sqlite': '7 nations — 64 bilateral diplomacy negotiations',
  diplomacy: '7 nations — Spring 1904 bilateral negotiations',
  'code-review': '3 reviewers — async function security review',
};

export function LandingPage() {
  const theme = useThemeStore((s) => s.activeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [watchCode, setWatchCode] = useState('');
  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('');

  useEffect(() => {
    fetch('/api/datasets')
      .then((r) => r.json() as Promise<{ datasets: string[]; active: string }>)
      .then((d) => {
        setDatasets(d.datasets);
        if (d.active) setSelectedDataset(d.active);
      })
      .catch(() => {});
  }, []);

  const handleThemeChange = useCallback((t: Theme) => {
    setTheme(t);
  }, [setTheme]);

  const startDemo = useCallback(() => {
    const dataParam = `&data=${selectedDataset}`;
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

        {/* Dataset selector with descriptions */}
        {datasets.length > 1 && (
          <div className="landing-section">
            <label className="landing-label">Dataset</label>
            <div className="landing-dataset-list">
              {datasets.map((d) => (
                <button
                  key={d}
                  className={`landing-dataset-card ${selectedDataset === d ? 'active' : ''}`}
                  onClick={() => setSelectedDataset(d)}
                >
                  <span className="landing-dataset-name">{d}</span>
                  <span className="landing-dataset-desc">{datasetDescriptions[d] ?? ''}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Theme picker with previews */}
        <div className="landing-section">
          <label className="landing-label">Theme</label>
          <div className="landing-theme-grid">
            {Object.entries(themeDescriptions).map(([t, td]) => (
                <button
                  key={t}
                  className={`landing-theme-card ${theme === t ? 'active' : ''}`}
                  onClick={() => handleThemeChange(t as Theme)}
                >
                  <div className="landing-theme-preview">
                    {td.colors.map((c, i) => (
                      <div key={i} className="landing-theme-swatch" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="landing-theme-name">{td.label}</div>
                  <div className="landing-theme-desc">{td.desc}</div>
                </button>
              ))}
          </div>
        </div>

        <div className="landing-section">
          <button className="landing-btn landing-btn-primary" onClick={startDemo} disabled={!selectedDataset}>
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
