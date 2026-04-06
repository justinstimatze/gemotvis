import { useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/theme';

interface LoginFormProps {
  onLogin: () => void;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const theme = useThemeStore((s) => s.activeTheme);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || `Error ${res.status}`);
        return;
      }
      onLogin();
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }, [apiKey, onLogin]);

  return (
    <div className={`login-overlay theme-${theme}`}>
      <div className="login-card">
        <h2 className="login-title">Agent Dashboard</h2>
        <p className="login-subtitle">Enter your gemot.dev API key to view your deliberations</p>
        <input
          className="login-input"
          type="password"
          placeholder="gmt_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
        />
        {error && <div className="login-error">{error}</div>}
        <button
          className="login-btn"
          onClick={handleSubmit}
          disabled={loading || !apiKey.trim()}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
