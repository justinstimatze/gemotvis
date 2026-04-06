import { useMemo } from 'react';
import { useGraphStore } from '../../stores/graph';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useSessionStore } from '../../stores/session';
import { ChatThread } from '../chat/ChatThread';
import { AnalysisSection } from '../chat/AnalysisSection';
import type { AgentInfo } from '../../types';

/** Center panel overlay — shows chat thread for the active bilateral. */
export function CenterPanel() {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const filteredDelibs = useFilteredState();
  const rawDelibs = useSessionStore((s) => s.deliberations);

  const ds = activeEdge ? filteredDelibs[activeEdge] : null;

  // Collect all agents across all deliberations for mention highlighting
  const allAgents = useMemo((): AgentInfo[] => {
    const agents: AgentInfo[] = [];
    for (const d of Object.values(rawDelibs)) {
      agents.push(...(d.agents ?? []));
    }
    return agents;
  }, [rawDelibs]);

  // Only show when animation is complete and we have an active edge with data
  if (!activeEdge || animationPhase !== 'ready' || !ds) return null;

  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];
  const topic = ds.deliberation?.topic ?? '';

  return (
    <div id="center-panel" className="center-panel-overlay">
      <div className="center-header">
        <span className="center-title">{topic}</span>
      </div>
      <ChatThread
        positions={positions}
        agents={agents}
        allAgents={allAgents}
      />
      {ds.analysis && <AnalysisSection analysis={ds.analysis} />}
    </div>
  );
}
