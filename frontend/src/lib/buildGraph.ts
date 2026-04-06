import type { DelibState, Graph, GraphEdge, GraphGroup } from '../types';

/** Count deliberations that have exactly 2 agents (bilaterals). */
export function countBilaterals(delibs: Record<string, DelibState>): number {
  return Object.values(delibs).filter(d => (d.agents?.length ?? 0) === 2).length;
}

/** Convert deliberations into a unified graph structure. */
export function buildGraphFromDelibs(delibs: Record<string, DelibState>): Graph {
  const ids = Object.keys(delibs);
  const allAgents = new Set<string>();
  const edges: GraphEdge[] = [];
  const groups: GraphGroup[] = [];
  let groupDelibID: string | null = null;

  // Track which agent pairs already have edges to avoid duplicates
  const edgeSet = new Set<string>();
  function addEdge(a: string, b: string, delibID: string) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ a, b, delibID });
    }
  }

  for (const id of ids) {
    const agents = (delibs[id]?.agents ?? []).map(a => a.id);
    agents.forEach(a => allAgents.add(a));

    if (agents.length === 2) {
      addEdge(agents[0]!, agents[1]!, id);
    } else if (agents.length >= 3) {
      groups.push({ delibID: id, agents });
    }
  }

  // Single deliberation with 3+ agents and no bilaterals:
  // create pairwise edges (the graph IS the deliberation)
  if (edges.length === 0 && groups.length === 1) {
    const g = groups[0]!;
    groupDelibID = g.delibID;
    for (let i = 0; i < g.agents.length; i++) {
      for (let j = i + 1; j < g.agents.length; j++) {
        addEdge(g.agents[i]!, g.agents[j]!, g.delibID);
      }
    }
  } else if (groups.length > 0) {
    // Multiple delibs: create edges between agents who share a group delib.
    // Use the group with most positions as the edge's delibID.
    for (const g of groups) {
      for (let i = 0; i < g.agents.length; i++) {
        for (let j = i + 1; j < g.agents.length; j++) {
          addEdge(g.agents[i]!, g.agents[j]!, g.delibID);
        }
      }
    }

    // Find a group delib whose agents are a superset of all agents
    for (const g of groups) {
      const gSet = new Set(g.agents);
      if ([...allAgents].every(a => gSet.has(a))) {
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
