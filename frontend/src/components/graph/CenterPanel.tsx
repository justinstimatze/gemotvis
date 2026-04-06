import { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../stores/graph';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useSessionStore } from '../../stores/session';
import { ChatThread } from '../chat/ChatThread';
import type { AgentInfo } from '../../types';

/** Center panel overlay — rendered as a portal to escape React Flow's stacking context. */
export function CenterPanel() {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const filteredDelibs = useFilteredState();
  const rawDelibs = useSessionStore((s) => s.deliberations);

  const ds = activeEdge ? filteredDelibs[activeEdge] : null;

  const allAgents = useMemo((): AgentInfo[] => {
    const agents: AgentInfo[] = [];
    for (const d of Object.values(rawDelibs)) {
      agents.push(...(d.agents ?? []));
    }
    return agents;
  }, [rawDelibs]);

  // Hooks must be called before any early return
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const toggleSearch = useCallback(() => {
    setSearchOpen(o => !o);
    if (searchOpen) setSearchQuery('');
  }, [searchOpen]);

  // Center panel for 2-4 agents, side panel for 5+
  // Use side panel when the delib has many agents OR the graph has many nodes (multi-delib)
  const rawDs = activeEdge ? rawDelibs[activeEdge] : null;
  const totalAgents = rawDs?.agents?.length ?? 0;
  const graphNodeCount = useGraphStore((s) => s.graphNodes.length);
  const useSidePanel = activeEdge && animationPhase === 'ready' && ds && (totalAgents > 4 || graphNodeCount > 5);

  // Set body class so graph-view can shrink when side panel is visible
  useEffect(() => {
    document.body.classList.toggle('has-side-panel', !!useSidePanel);
    return () => { document.body.classList.remove('has-side-panel'); };
  }, [useSidePanel]);

  if (!activeEdge || animationPhase !== 'ready' || !ds) return null;

  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];
  const topic = ds.deliberation?.topic ?? '';
  const panelClass = useSidePanel ? 'chat-panel-side' : 'center-panel-overlay';

  return createPortal(
    <div className={panelClass}>
      <div className="center-header">
        <span className="center-title">{topic}</span>
        <button className="center-search-btn" onClick={toggleSearch} title="Search messages (/)">
          &#128269;
        </button>
      </div>
      {searchOpen && (
        <div className="center-search-bar">
          <input
            className="center-search-input"
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button className="center-search-clear" onClick={() => setSearchQuery('')}>&times;</button>
          )}
        </div>
      )}
      <ChatThread
        positions={positions}
        agents={agents}
        allAgents={allAgents}
        searchQuery={searchQuery}
      />
    </div>,
    document.body,
  );
}
