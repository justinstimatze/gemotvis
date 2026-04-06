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
}

type DelibEdgeType = Edge<DelibEdgeData, 'delib'>;

function DelibEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<DelibEdgeType>) {
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const animationPhase = useGraphStore((s) => s.animationPhase);
  const setActiveEdge = useGraphStore((s) => s.setActiveEdge);

  const isActive = (data?.highlighted ?? false) && animationPhase === 'ready';
  const isEmpty = (data?.posCount ?? 0) === 0;
  const posCount = data?.posCount ?? 0;

  const thickness = isActive ? 4 : Math.min(1.5 + posCount * 0.08, 3);
  const opacity = isActive ? 0.5 : isEmpty ? 0.15 : Math.min(0.2 + posCount * 0.005, 0.4);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX, sourceY, targetX, targetY,
  });

  // Click edge to focus its bilateral conversation
  const handleClick = useCallback(() => {
    if (!data?.delibID) return;
    // Pause autoplay and focus this bilateral
    useScrubberStore.getState().setPlaying(false);
    setActiveEdge(data.delibID);
    // Find the first event for this delib in the timeline
    const events = useScrubberStore.getState().events;
    const idx = events.findIndex(e => e.delibID === data.delibID);
    if (idx >= 0) useScrubberStore.getState().setEventIndex(idx);
  }, [data?.delibID, setActiveEdge]);

  const classes = [
    'graph-edge-path',
    isActive ? 'graph-edge-active' : '',
    isEmpty ? 'graph-edge-empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Invisible wide hit area for clicking */}
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
      {/* Message count badge — clickable in overview mode */}
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
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const DelibEdge = memo(DelibEdgeComponent);
