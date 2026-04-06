import type { AgentInfo, DelibState, Graph, NodePosition } from '../types';

// ---- Polygon positions ----

const LAYOUTS: Record<number, { x: number; y: number }[]> = {
  2: [{ x: 12, y: 40 }, { x: 88, y: 40 }],
  3: [{ x: 12, y: 18 }, { x: 88, y: 18 }, { x: 50, y: 78 }],
  4: [{ x: 12, y: 15 }, { x: 88, y: 15 }, { x: 12, y: 80 }, { x: 88, y: 80 }],
};

export function polygonPosition(i: number, n: number): { x: number; y: number } {
  const fixed = LAYOUTS[n];
  if (fixed?.[i]) return fixed[i];

  const angle = (2 * Math.PI * i / n) - Math.PI / 2;
  const rx = n <= 4 ? 38 : n <= 5 ? 40 : 42;
  const ry = n <= 4 ? 35 : n <= 5 ? 38 : 40;
  return {
    x: 50 + rx * Math.cos(angle),
    y: 46 + ry * Math.sin(angle),
  };
}

// ---- Lat/lon projection ----

export interface LatLonBounds {
  minLat: number; maxLat: number;
  minLon: number; maxLon: number;
}

export function computeLatLonBounds(agents: AgentInfo[]): LatLonBounds | null {
  const withCoords = agents.filter(a => a.lat != null && a.lon != null);
  if (withCoords.length === 0) return null;

  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const a of withCoords) {
    minLat = Math.min(minLat, a.lat!);
    maxLat = Math.max(maxLat, a.lat!);
    minLon = Math.min(minLon, a.lon!);
    maxLon = Math.max(maxLon, a.lon!);
  }
  const latRange = maxLat - minLat || 10;
  const lonRange = maxLon - minLon || 10;
  const pad = 0.25;
  return {
    minLat: minLat - latRange * pad,
    maxLat: maxLat + latRange * pad,
    minLon: minLon - lonRange * pad,
    maxLon: maxLon + lonRange * pad,
  };
}

export function latLonToXY(lat: number, lon: number, bounds: LatLonBounds | null): { x: number; y: number } {
  if (!bounds) {
    return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
  }
  const rawX = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
  const rawY = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * 100;
  const margin = 8;
  return {
    x: margin + Math.max(0, Math.min(100, rawX)) * (100 - 2 * margin) / 100,
    y: margin + Math.max(0, Math.min(100, rawY)) * (100 - 2 * margin) / 100,
  };
}

// ---- Node position computation ----

export interface LayoutResult {
  positions: NodePosition[];
  showWorldMap: boolean;
}

/** Collect all agents that have lat/lon coordinates from all deliberations. */
export function collectAgentsWithCoords(delibs: Record<string, DelibState>): AgentInfo[] {
  const result: AgentInfo[] = [];
  for (const ds of Object.values(delibs)) {
    for (const a of ds.agents ?? []) {
      if (a.lat != null && a.lon != null) result.push(a);
    }
  }
  return result;
}

/** Compute positions for all graph nodes. Priority: lat/lon > explicit xy > island layout. */
export function getGraphNodePositions(
  graph: Graph,
  delibs: Record<string, DelibState>,
): LayoutResult {
  const nodes = graph.nodes;

  // Check for lat/lon coordinates
  const allAgentsWithLatLon = collectAgentsWithCoords(delibs);
  if (allAgentsWithLatLon.length > 0) {
    const bounds = computeLatLonBounds(allAgentsWithLatLon);
    const latLonMap: Record<string, { x: number; y: number }> = {};
    for (const a of allAgentsWithLatLon) {
      if (!latLonMap[a.id]) latLonMap[a.id] = latLonToXY(a.lat!, a.lon!, bounds);
    }
    if (nodes.every(n => latLonMap[n])) {
      return {
        positions: nodes.map(n => ({ id: n, ...latLonMap[n]! })),
        showWorldMap: true,
      };
    }
  }

  // Check for explicit x,y
  for (const ds of Object.values(delibs)) {
    const agents = ds.agents ?? [];
    if (agents.some(a => a.x != null && a.y != null)) {
      const posMap: Record<string, { x: number; y: number }> = {};
      for (const a of agents) {
        if (a.x != null && a.y != null) posMap[a.id] = { x: a.x, y: a.y };
      }
      if (nodes.every(n => posMap[n])) {
        return {
          positions: nodes.map(n => ({ id: n, ...posMap[n]! })),
          showWorldMap: false,
        };
      }
    }
  }

  // Union-find for connected components (islands)
  const parent: Record<string, string> = {};
  for (const n of nodes) parent[n] = n;

  function find(x: string): string {
    if (parent[x] !== x) parent[x] = find(parent[x]!);
    return parent[x]!;
  }
  function union(a: string, b: string) { parent[find(a)] = find(b); }

  for (const e of graph.edges) union(e.a, e.b);
  for (const g of graph.groups ?? []) {
    for (let i = 1; i < g.agents.length; i++) {
      if (parent[g.agents[i]!] !== undefined) union(g.agents[0]!, g.agents[i]!);
    }
  }

  const components: Record<string, string[]> = {};
  for (const n of nodes) {
    const root = find(n);
    if (!components[root]) components[root] = [];
    components[root]!.push(n);
  }
  const islands = Object.values(components).sort((a, b) => b.length - a.length);

  // Single island: polygon for ≤7 nodes, force-directed for 8+
  if (islands.length === 1) {
    if (nodes.length > 7) {
      return {
        positions: forceDirectedLayout(nodes, graph.edges),
        showWorldMap: false,
      };
    }
    return {
      positions: nodes.map((id, i) => ({ id, ...polygonPosition(i, nodes.length) })),
      showWorldMap: false,
    };
  }

  // Multiple islands: grid layout
  const result: NodePosition[] = [];
  const cols = Math.min(islands.length, 4);
  const rows = Math.ceil(islands.length / cols);

  islands.forEach((island, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const regionW = 100 / cols;
    const regionH = 100 / rows;
    const cx = regionW * (col + 0.5);
    const cy = regionH * (row + 0.5);
    const radius = Math.min(regionW, regionH) * 0.35;

    island.forEach((id, i) => {
      if (island.length === 1) {
        result.push({ id, x: cx, y: cy });
      } else {
        const angle = (2 * Math.PI * i / island.length) - Math.PI / 2;
        result.push({
          id,
          x: cx + radius * Math.cos(angle) * 0.9,
          y: cy + radius * Math.sin(angle) * 0.85,
        });
      }
    });
  });

  return { positions: result, showWorldMap: false };
}

// ---- Focused layout ----

/** Snap active bilateral agents left/right; keep others at base positions. */
export function computeFocusedLayout(
  basePositions: NodePosition[],
  activeAgentA: string,
  activeAgentB: string,
): NodePosition[] {
  return basePositions.map(n => {
    if (n.id === activeAgentA) return { ...n, x: 15, y: 40 };
    if (n.id === activeAgentB) return { ...n, x: 85, y: 40 };
    return n;
  });
}

// ---- Force-directed layout ----

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';

interface ForceNode extends SimulationNodeDatum {
  id: string;
}

/** Force-directed layout for dense graphs (8+ nodes or many edges). */
export function forceDirectedLayout(
  nodeIds: string[],
  edges: { a: string; b: string }[],
): NodePosition[] {
  const nodes: ForceNode[] = nodeIds.map(id => ({ id }));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const links: SimulationLinkDatum<ForceNode>[] = edges
    .filter(e => nodeMap.has(e.a) && nodeMap.has(e.b))
    .map(e => ({ source: nodeMap.get(e.a)!, target: nodeMap.get(e.b)! }));

  const sim = forceSimulation(nodes)
    .force('link', forceLink(links).id((d) => (d as ForceNode).id).distance(120))
    .force('charge', forceManyBody().strength(-400))
    .force('center', forceCenter(50, 50))
    .force('collide', forceCollide(15))
    .stop();

  // Run synchronously
  for (let i = 0; i < 300; i++) sim.tick();

  // Normalize to 0-100 range with margin
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x! < minX) minX = n.x!;
    if (n.x! > maxX) maxX = n.x!;
    if (n.y! < minY) minY = n.y!;
    if (n.y! > maxY) maxY = n.y!;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const margin = 10;

  return nodes.map(n => ({
    id: n.id,
    x: margin + ((n.x! - minX) / rangeX) * (100 - 2 * margin),
    y: margin + ((n.y! - minY) / rangeY) * (100 - 2 * margin),
  }));
}
