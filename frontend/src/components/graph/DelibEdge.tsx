import { memo, useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { useGraphStore } from '../../stores/graph';
import { useScrubberStore } from '../../stores/scrubber';

export interface DelibEdgeData extends Record<string, unknown> {
  delibID: string;
  posCount: number;
  highlighted: boolean;
  cruxCount: number;
}

type DelibEdgeType = Edge<DelibEdgeData, 'delib'>;

function edgeStyle(posCount: number, isActive: boolean, isHovered: boolean) {
  if (isActive) return { thickness: 4, opacity: 0.5 };
  if (isHovered) return { thickness: 3, opacity: 0.6 };
  if (posCount === 0) return { thickness: 1.5, opacity: 0.15 };
  return {
    thickness: Math.min(1.5 + posCount * 0.08, 3),
    opacity: Math.min(0.2 + posCount * 0.005, 0.4),
  };
}

function DelibEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<DelibEdgeType>) {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const activeNode = useGraphStore((s) => s.activeNode);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const setActiveEdge = useGraphStore((s) => s.setActiveEdge);

  const posCount = data?.posCount ?? 0;
  const cruxCount = data?.cruxCount ?? 0;
  const isActive = (data?.highlighted ?? false) && animationPhase === 'ready';
  const isHovered = activeNode != null && (source === activeNode || target === activeNode);
  const { thickness, opacity } = edgeStyle(posCount, isActive, isHovered);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX, sourceY, targetX, targetY,
  });

  const handleClick = useCallback(() => {
    if (!data?.delibID) return;
    useScrubberStore.getState().setPlaying(false);
    setActiveEdge(data.delibID);
    const events = useScrubberStore.getState().events;
    const idx = events.findIndex(e => e.delibID === data.delibID);
    if (idx >= 0) useScrubberStore.getState().setEventIndex(idx);
  }, [data?.delibID, setActiveEdge]);

  const classes = [
    'graph-edge-path',
    isActive && 'graph-edge-active',
    isHovered && 'graph-edge-hover',
    posCount === 0 && 'graph-edge-empty',
  ].filter(Boolean).join(' ');

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: posCount > 0 ? 'pointer' : 'default' }}
        onClick={handleClick}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        className={classes}
        style={{ strokeWidth: thickness, opacity, pointerEvents: 'none' }}
      />
      {posCount > 0 && !activeEdge && (
        <EdgeLabelRenderer>
          <div
            className="edge-label-badge"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              cursor: 'pointer',
            }}
            onClick={handleClick}
          >
            {posCount}
            {cruxCount > 0 && <span className="edge-crux-badge" title={`${cruxCount} disagreement${cruxCount > 1 ? 's' : ''}`}>{cruxCount}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
      {/* Crux indicator on active/hovered edges */}
      {cruxCount > 0 && (isActive || isHovered) && (
        <EdgeLabelRenderer>
          <div
            className="edge-crux-indicator"
            style={{
              position: 'absolute',
              transform: `translate(-50%, 8px) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {cruxCount} crux{cruxCount > 1 ? 'es' : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const DelibEdge = memo(DelibEdgeComponent);
