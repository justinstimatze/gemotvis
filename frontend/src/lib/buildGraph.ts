import type { DelibState, Graph, GraphEdge, GraphGroup } from '../types';

/** Convert deliberations into a unified graph structure. */
export function buildGraphFromDelibs(delibs: Record<string, DelibState>): Graph {
  const ids = Object.keys(delibs);
  const allAgents = new Set<string>();
  const edges: GraphEdge[] = [];
  const groups: GraphGroup[] = [];
  let groupDelibID: string | null = null;

  for (const id of ids) {
    const agents = (delibs[id]?.agents ?? []).map(a => a.id);
    agents.forEach(a => allAgents.add(a));

    if (agents.length === 2) {
      edges.push({ a: agents[0]!, b: agents[1]!, delibID: id });
    } else if (agents.length >= 3) {
      groups.push({ delibID: id, agents });
    }
  }

  // Single deliberation with 3+ agents and no bilaterals:
  // create pairwise edges (the graph IS the deliberation)
  if (edges.length === 0 && groups.length > 0) {
    const g = groups[0]!;
    groupDelibID = g.delibID;
    for (let i = 0; i < g.agents.length; i++) {
      for (let j = i + 1; j < g.agents.length; j++) {
        edges.push({ a: g.agents[i]!, b: g.agents[j]!, delibID: g.delibID });
      }
    }
  } else {
    // Find a group delib whose agents are a superset of bilateral agents
    const bilateralAgents = new Set<string>();
    edges.forEach(e => { bilateralAgents.add(e.a); bilateralAgents.add(e.b); });
    for (const g of groups) {
      const gSet = new Set(g.agents);
      if ([...bilateralAgents].every(a => gSet.has(a))) {
        groupDelibID = g.delibID;
        break;
      }
    }
  }

  return {
    nodes: [...allAgents].sort(),
    edges,
    groupDelibID,
    groups,
  };
}
