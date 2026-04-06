import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../stores/graph';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useSessionStore } from '../../stores/session';
import { ChatThread } from '../chat/ChatThread';
import { AnalysisSection } from '../chat/AnalysisSection';
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

  if (!activeEdge || animationPhase !== 'ready' || !ds) return null;

  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];
  const topic = ds.deliberation?.topic ?? '';

  // Portal to #screen so the panel is outside React Flow's stacking context
  const target = document.getElementById('screen');
  if (!target) return null;

  return createPortal(
    <div className="center-panel-overlay">
      <div className="center-header">
        <span className="center-title">{topic}</span>
      </div>
      <ChatThread
        positions={positions}
        agents={agents}
        allAgents={allAgents}
      />
      {ds.analysis && <AnalysisSection analysis={ds.analysis} />}
    </div>,
    target,
  );
}
