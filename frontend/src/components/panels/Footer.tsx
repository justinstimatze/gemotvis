import { useGraphStore } from '../../stores/graph';
import { useFilteredState } from '../../hooks/useFilteredState';
import { CruxPanel } from './CruxPanel';
import { MetricsPanel } from './MetricsPanel';
import { AuditLog } from './AuditLog';

export function Footer() {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const filteredDelibs = useFilteredState();

  if (!activeEdge || animationPhase !== 'ready') return null;

  const ds = filteredDelibs[activeEdge] ?? null;

  return (
    <div className="graph-footer" id="footer">
      <CruxPanel ds={ds} />
      <MetricsPanel ds={ds} />
      <AuditLog ds={ds} />
    </div>
  );
}
