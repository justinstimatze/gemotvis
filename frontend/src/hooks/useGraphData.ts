import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { DelibState } from '../types';
import type { AgentNodeData } from '../components/graph/AgentNode';
import type { DelibEdgeData } from '../components/graph/DelibEdge';
import type { Graph, NodePosition } from '../types';
import { buildRFNodes, buildRFEdges } from '../lib/graphData';

/** Memoized React Flow nodes from layout positions and deliberation data. */
export function useRFNodes(
  nodePositions: NodePosition[],
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
): Node<AgentNodeData>[] {
  return useMemo(
    () => buildRFNodes(nodePositions, graph, filteredDelibs, activeEdge),
    [nodePositions, graph, filteredDelibs, activeEdge],
  );
}

/** Memoized React Flow edges from graph edges and deliberation data. */
export function useRFEdges(
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
): Edge<DelibEdgeData>[] {
  return useMemo(
    () => buildRFEdges(graph, filteredDelibs, activeEdge),
    [graph.edges, filteredDelibs, activeEdge],
  );
}
