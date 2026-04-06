import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { useGraphStore } from '../../stores/graph';

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

  const isActive = (data?.highlighted ?? false) && animationPhase === 'ready';
  const isEmpty = (data?.posCount ?? 0) === 0;
  const posCount = data?.posCount ?? 0;

  const thickness = isActive ? 3 : Math.min(0.8 + posCount * 0.04, 2);
  const opacity = isActive ? 0.5 : isEmpty ? 0.06 : Math.min(0.08 + posCount * 0.003, 0.25);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX, sourceY, targetX, targetY,
  });

  const classes = [
    'graph-edge-path',
    isActive ? 'graph-edge-active' : '',
    isEmpty ? 'graph-edge-empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={classes}
        style={{ strokeWidth: thickness, opacity }}
      />
      {/* Message count badge — only in overview mode (no active edge) */}
      {posCount > 0 && !activeEdge && (
        <EdgeLabelRenderer>
          <div
            className="edge-label-badge"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            {posCount}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const DelibEdge = memo(DelibEdgeComponent);
