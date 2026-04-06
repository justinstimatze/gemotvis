import { memo } from 'react';
import {
  BaseEdge,
  getStraightPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { useGraphStore } from '../../stores/graph';

export interface DelibEdgeData extends Record<string, unknown> {
  delibID: string;
  posCount: number;
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

  const isActive = data?.delibID === activeEdge && animationPhase === 'ready';
  const isEmpty = (data?.posCount ?? 0) === 0;
  const posCount = data?.posCount ?? 0;

  const thickness = Math.min(0.8 + posCount * 0.04, 2);
  const opacity = isEmpty ? 0.06 : Math.min(0.08 + posCount * 0.003, 0.25);

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
        style={{
          strokeWidth: isActive ? 3 : thickness,
          opacity: isActive ? 0.5 : opacity,
        }}
      />
      {posCount > 0 && !activeEdge && (
        <text
          x={labelX}
          y={labelY}
          className="graph-edge-count"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {posCount}
        </text>
      )}
    </>
  );
}

export const DelibEdge = memo(DelibEdgeComponent);
