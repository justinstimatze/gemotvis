import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../stores/graph';
import { useFocusedDelib } from '../../hooks/useFocusedDelib';
import { CruxPanel } from './CruxPanel';
import { MetricsPanel } from './MetricsPanel';
import { ConsensusPanel } from './ConsensusPanel';
import { AuditLog } from './AuditLog';
import { ScrubberBar } from '../scrubber/ScrubberBar';

/** Combined bottom bar: scrubber on top, data panels below. */
export function Footer() {
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const { ds: focusedDs, activeEdge } = useFocusedDelib();

  const showPanels = activeEdge && animationPhase === 'ready';
  const ds = showPanels ? focusedDs : null;

  // Track bottom bar height so side panel can position above it
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty('--bottom-bar-h', `${el.offsetHeight}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return createPortal(
    <div className="bottom-bar" ref={barRef}>
      <ScrubberBar />
      {showPanels && ds && (
        <div className="graph-footer">
          <CruxPanel ds={ds} />
          {ds.analysis?.consensus_statements?.length ? <ConsensusPanel ds={ds} /> : <MetricsPanel ds={ds} />}
          <AuditLog ds={ds} />
        </div>
      )}
    </div>,
    document.body,
  );
}
