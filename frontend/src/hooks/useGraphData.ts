import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { DelibState } from '../types';
import type { AgentNodeData } from '../components/graph/AgentNode';
import type { DelibEdgeData } from '../components/graph/DelibEdge';
import type { Graph, NodePosition } from '../types';

const CANVAS_W = 1600;
const CANVAS_H = 900;

/** Build React Flow node objects from layout positions and deliberation data. */
export function useRFNodes(
  nodePositions: NodePosition[],
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
): Node<AgentNodeData>[] {
  return useMemo(() => {
    const uniqueDelibIDs = new Set(graph.edges.map(e => e.delibID));
    const isSingleDelib = uniqueDelibIDs.size <= 1;

    return nodePositions.map((np) => {
      let totalMessages = 0;
      let activeGemots = 0;
      for (const edge of graph.edges) {
        if (edge.a === np.id || edge.b === np.id) {
          const ds = filteredDelibs[edge.delibID];
          const pc = (ds?.positions ?? []).length;
          totalMessages += pc;
          if (pc > 0) activeGemots++;
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

      // Find cluster ID from any delib's analysis that includes this agent
      let clusterId: number | undefined;
      for (const ds of Object.values(filteredDelibs)) {
        const agent = ds.agents?.find(a => a.id === np.id);
        if (agent?.cluster_id != null) { clusterId = agent.cluster_id; break; }
      }

      // Find aggregate vote direction
      let voteDirection: -1 | 0 | 1 | undefined;
      for (const ds of Object.values(filteredDelibs)) {
        const vote = ds.votes?.find(v => v.agent_id === np.id);
        if (vote) { voteDirection = vote.value as -1 | 0 | 1; break; }
      }

      // Find best bridging score for this agent
      let bridgingScore = 0;
      for (const ds of Object.values(filteredDelibs)) {
        for (const bs of ds.analysis?.bridging_statements ?? []) {
          if (bs.agent_id === np.id && bs.bridging_score > bridgingScore) {
            bridgingScore = bs.bridging_score;
          }
        }
      }

      return {
        id: np.id,
        type: 'agent' as const,
        position: { x: np.x / 100 * CANVAS_W, y: np.y / 100 * CANVAS_H },
        width: 130,
        height: 120,
        data: {
          agentId: np.id,
          totalMessages,
          activeGemots,
          agentIndex: graph.nodes.indexOf(np.id),
          agentCount: graph.nodes.length,
          isEdgeAgent,
          sideClass,
          clusterId,
          voteDirection,
          bridgingScore,
        },
      };
    });
  }, [nodePositions, graph, filteredDelibs, activeEdge]);
}

/** Count cruxes where two agents disagree (one agrees, other disagrees). */
function countDisagreements(delibs: Record<string, DelibState>, agentA: string, agentB: string): number {
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

/** Build React Flow edge objects from graph edges and deliberation data. */
export function useRFEdges(
  graph: Graph,
  filteredDelibs: Record<string, DelibState>,
  activeEdge: string | null,
): Edge<DelibEdgeData>[] {
  return useMemo(() => {
    const uniqueDelibIDs = new Set(graph.edges.map(e => e.delibID));
    const isSingleDelib = uniqueDelibIDs.size <= 1;

    return graph.edges.map((edge) => {
      const ds = filteredDelibs[edge.delibID];
      const posCount = (ds?.positions ?? []).length;
      const highlighted = !isSingleDelib && edge.delibID === activeEdge;
      const cruxCount = countDisagreements(filteredDelibs, edge.a, edge.b);
      // Check if this delib reached consensus (any statement with >70% agreement)
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
  }, [graph.edges, filteredDelibs, activeEdge]);
}
