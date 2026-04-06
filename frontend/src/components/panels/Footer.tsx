import { createPortal } from 'react-dom';
import { useGraphStore } from '../../stores/graph';
import { useFilteredState } from '../../hooks/useFilteredState';
import { CruxPanel } from './CruxPanel';
import { MetricsPanel } from './MetricsPanel';
import { AuditLog } from './AuditLog';
import { ScrubberBar } from '../scrubber/ScrubberBar';

/** Combined bottom bar: scrubber on top, data panels below. */
export function Footer() {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const filteredDelibs = useFilteredState();

  const showPanels = activeEdge && animationPhase === 'ready';
  const ds = showPanels ? (filteredDelibs[activeEdge] ?? null) : null;

  return createPortal(
    <div className="bottom-bar">
      <ScrubberBar />
      {showPanels && ds && (
        <div className="graph-footer">
          <CruxPanel ds={ds} />
          <MetricsPanel ds={ds} />
          <AuditLog ds={ds} />
        </div>
      )}
    </div>,
    document.body,
  );
}
