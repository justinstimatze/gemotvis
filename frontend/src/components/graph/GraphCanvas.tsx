import { useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import { useSessionStore } from '../../stores/session';
import { useGraphStore } from '../../stores/graph';
import { useScrubberStore } from '../../stores/scrubber';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useAnimationPhase } from '../../hooks/useAnimationPhase';
import { buildGraphFromDelibs } from '../../lib/buildGraph';
import { getGraphNodePositions, computeFocusedLayout } from '../../lib/layout';
import { AgentNode, type AgentNodeData } from './AgentNode';
import { DelibEdge, type DelibEdgeData } from './DelibEdge';
import { CenterPanel } from './CenterPanel';
import { WorldMap } from './WorldMap';

const nodeTypes = { agent: AgentNode };
const edgeTypes = { delib: DelibEdge };

// Layout uses 0-100 percentages; React Flow uses pixels
const CANVAS_W = 1600;
const CANVAS_H = 900;

function GraphCanvasInner() {
  const rawDelibs = useSessionStore((s) => s.deliberations);
  const filteredDelibs = useFilteredState();
  const activeEdge = useGraphStore((s) => s.activeEdge);
  // const theme = useThemeStore((s) => s.activeTheme); // was for MiniMap
  const { fitView } = useReactFlow();
  // (prevActiveEdge removed — fitView now triggers on node count change instead)
  useAnimationPhase();

  // Build graph from all deliberations.
  // For multi-delib bilateral data (like v9 diplomacy), we show all agents
  // and all edges, highlighting the active bilateral.
  // For single-delib data (like the built-in 5-agent demos), the graph
  // shows just that delib's agents with pairwise edges.
  const graph = useMemo(() => {
    // Count how many delibs have 2 agents (bilaterals)
    const bilateralCount = Object.values(rawDelibs).filter(d => d.agents?.length === 2).length;
    // If we have multiple bilaterals, show the full graph (multi-delib mode)
    if (bilateralCount > 1) return buildGraphFromDelibs(rawDelibs);
    // Otherwise, show only the active delib's agents (single-delib focus)
    const delibs = activeEdge && rawDelibs[activeEdge]
      ? { [activeEdge]: rawDelibs[activeEdge] }
      : rawDelibs;
    return buildGraphFromDelibs(delibs);
  }, [rawDelibs, activeEdge]);

  // Compute node positions (layout algorithm)
  const layoutResult = useMemo(() => {
    return getGraphNodePositions(graph, rawDelibs);
  }, [graph, rawDelibs]);

  // Apply focused layout if bilateral is active
  const nodePositions = useMemo(() => {
    if (!activeEdge) return layoutResult.positions;
    const uniqueDelibIDs = new Set(graph.edges.map(e => e.delibID));
    const isSingleDelib = uniqueDelibIDs.size <= 1;
    if (isSingleDelib) return layoutResult.positions;

    const edge = graph.edges.find(e => e.delibID === activeEdge);
    if (edge) return computeFocusedLayout(layoutResult.positions, edge.a, edge.b);
    return layoutResult.positions;
  }, [layoutResult.positions, activeEdge, graph.edges]);

  // Build React Flow nodes
  const rfNodes = useMemo((): Node<AgentNodeData>[] => {
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
        },
      };
    });
  }, [nodePositions, graph, filteredDelibs, activeEdge]);

  // Build React Flow edges
  const rfEdges = useMemo((): Edge<DelibEdgeData>[] => {
    const uniqueDelibIDs = new Set(graph.edges.map(e => e.delibID));
    const isSingleDelib = uniqueDelibIDs.size <= 1;

    return graph.edges.map((edge) => {
      const ds = filteredDelibs[edge.delibID];
      const posCount = (ds?.positions ?? []).length;
      // Only highlight in multi-delib mode (where each edge = different bilateral)
      const highlighted = !isSingleDelib && edge.delibID === activeEdge;
      return {
        id: `${edge.delibID}-${edge.a}-${edge.b}`,
        source: edge.a,
        target: edge.b,
        type: 'delib' as const,
        data: { delibID: edge.delibID, posCount, highlighted },
      };
    });
  }, [graph.edges, filteredDelibs]);

  // fitView when the number of nodes changes (different delib = different agent count)
  const prevNodeCount = useRef(rfNodes.length);
  useEffect(() => {
    if (rfNodes.length !== prevNodeCount.current) {
      prevNodeCount.current = rfNodes.length;
      const timer = setTimeout(() => {
        fitView({ padding: 0.35, duration: 600 });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, fitView]);

  // Node click: cycle through bilaterals for that agent
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node<AgentNodeData>) => {
    const agentId = node.data.agentId;
    // Find all edges involving this agent, sorted by message count descending.
    // Use rawDelibs (not filtered) so we can navigate to delibs not yet revealed by scrubber.
    const agentEdges = graph.edges
      .filter(e => e.a === agentId || e.b === agentId)
      .map(e => {
        const ds = rawDelibs[e.delibID];
        return { delibID: e.delibID, posCount: (ds?.positions ?? []).length };
      })
      .filter(e => e.posCount > 0)
      .sort((a, b) => b.posCount - a.posCount);

    if (agentEdges.length === 0) return;

    // Cycle: if current activeEdge is one of this agent's edges, go to the next one
    const currentIdx = agentEdges.findIndex(e => e.delibID === activeEdge);
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % agentEdges.length : 0;
    const nextDelib = agentEdges[nextIdx]!.delibID;

    useScrubberStore.getState().setPlaying(false);
    useGraphStore.getState().setActiveEdge(nextDelib);
    const events = useScrubberStore.getState().events;
    const idx = events.findIndex(e => e.delibID === nextDelib);
    if (idx >= 0) useScrubberStore.getState().setEventIndex(idx);
  }, [graph.edges, rawDelibs, activeEdge]);

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
      </ReactFlow>
      <WorldMap show={layoutResult.showWorldMap} />
    </>
  );
}

/** Wrapper that provides ReactFlowProvider context for useReactFlow(). */
export function GraphCanvas() {
  return (
    <div className="graph-view" style={{ width: '100%', height: '100%' }}>
      <GraphCanvasInner />
      <CenterPanel /> {/* Renders as portal to #screen */}
    </div>
  );
}
