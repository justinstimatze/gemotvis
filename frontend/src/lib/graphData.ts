import type { Node, Edge } from '@xyflow/react';
import type { DelibState } from '../types';
import type { AgentNodeData } from '../components/graph/AgentNode';
import type { DelibEdgeData } from '../components/graph/DelibEdge';
import type { Graph, NodePosition } from '../types';
import { getPositionCount } from './helpers';

/** Check if a graph represents a single deliberation (or none). */
export function isSingleDelibGraph(graph: Graph): boolean {
  return new Set(graph.edges.map(e => e.delibID)).size <= 1;
}

const CANVAS_W = 1600;
const CANVAS_H = 900;

/** Count cruxes where two agents disagree (one agrees, other disagrees). */
export function countDisagreements(delibs: Record<string, DelibState>, agentA: string, agentB: string): number {
  let count = 0;
  for (const ds of Object.values(delibs)) {
    for (const crux of ds.analysis?.cruxes ?? []) {
      const aAgrees = crux.agree_agents.includes(agentA);
      const aDisagrees = crux.disagree_agents.includes(agentA);
      const bAgrees = crux.agree_agents.includes(agentB);
      const bDisagrees = crux.disagree_agents.includes(agentB);
      if ((aAgrees && bDisagrees) || (aDisagrees && bAgrees)) count++;
    }
  }
  return count;
}

function findInDelibs<T>(
  delibs: Record<string, DelibState>,
  agentId: string,
  extractor: (ds: DelibState, agentId: string) => T | undefined,
): T | undefined {
  for (const ds of Object.values(delibs)) {
    const result = extractor(ds, agentId);
    if (result !== undefined) return result;
  }
  return undefined;
}

/** Pure function: build React Flow node data from layout positions and delib data. */
export function buildRFNodes(
  nodePositions: NodePosition[],
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
  rawDelibs?: Record<string, DelibState>,
): Node<AgentNodeData>[] {
  const isSingleDelib = isSingleDelibGraph(graph);

  return nodePositions.map((np) => {
    let totalMessages = 0;
    let activeGemots = 0;
    let hasOpenDelib = false;
    for (const edge of graph.edges) {
      if (edge.a === np.id || edge.b === np.id) {
        const ds = filteredDelibs[edge.delibID];
        const pc = getPositionCount(ds);
        totalMessages += pc;
        if (pc > 0) activeGemots++;
        // Check status from raw (unfiltered) data so scrubber position doesn't affect dimming
        const rawDs = (rawDelibs ?? filteredDelibs)[edge.delibID];
        const status = rawDs?.deliberation?.status;
        if (status === 'open' || status === 'analyzing') hasOpenDelib = true;
      }
    }

    const isEdgeAgent = isSingleDelib
      ? activeEdge != null
      : (activeEdge != null && graph.edges.some(e =>
        e.delibID === activeEdge && (e.a === np.id || e.b === np.id)));

    let sideClass = '';
    if (isEdgeAgent && activeEdge) {
      const rawDelib = filteredDelibs[activeEdge];
      const allAgents = rawDelib ? (rawDelib.agents ?? []).map(a => a.id) : graph.nodes;
      const agentIdx = allAgents.indexOf(np.id);
      sideClass = (agentIdx % 2 === 0) ? 'graph-node-left' : 'graph-node-right';
    }

    const clusterId = findInDelibs(filteredDelibs, np.id, (ds, id) => ds.agents?.find(a => a.id === id)?.cluster_id);

    const voteDirection = findInDelibs(filteredDelibs, np.id, (ds, id) => ds.votes?.find(v => v.agent_id === id)?.value as -1 | 0 | 1 | undefined);

    let bridgingScore = 0;
    for (const ds of Object.values(filteredDelibs)) {
      for (const bs of ds.analysis?.bridging_statements ?? []) {
        if (bs.agent_id === np.id && bs.bridging_score > bridgingScore) {
          bridgingScore = bs.bridging_score;
        }
      }
    }

    // Scale node dimensions with icon size
    const nodeW = graph.nodes.length <= 3 ? 180 : graph.nodes.length <= 5 ? 160 : 140;
    const nodeH = graph.nodes.length <= 3 ? 170 : graph.nodes.length <= 5 ? 155 : 135;

    return {
      id: np.id,
      type: 'agent' as const,
      position: { x: np.x / 100 * CANVAS_W, y: np.y / 100 * CANVAS_H },
      width: nodeW,
      height: nodeH,
      data: {
        agentId: np.id,
        totalMessages,
        activeGemots,
        agentIndex: graph.nodes.indexOf(np.id),
        agentCount: graph.nodes.length,
        isEdgeAgent,
        hasOpenDelib,
        singleDelib: isSingleDelib,
        sideClass,
        clusterId,
        voteDirection,
        bridgingScore,
      },
    };
  });
}

/** Pure function: build React Flow edge data from graph edges and delib data. */
export function buildRFEdges(
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
): Edge<DelibEdgeData>[] {
  const isSingleDelib = isSingleDelibGraph(graph);

  return graph.edges.map((edge) => {
    const ds = filteredDelibs[edge.delibID];
    const posCount = getPositionCount(ds);
    const highlighted = !isSingleDelib && edge.delibID === activeEdge;
    const cruxCount = countDisagreements(filteredDelibs, edge.a, edge.b);
    const consensus = ds?.analysis?.consensus_statements ?? [];
    const hasConsensus = consensus.some(c => c.overall_agree_ratio >= 0.7);
    return {
      id: `${edge.delibID}-${edge.a}-${edge.b}`,
      source: edge.a,
      target: edge.b,
      type: 'delib' as const,
      data: { delibID: edge.delibID, posCount, highlighted, cruxCount, hasConsensus },
    };
  });
}
