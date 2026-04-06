import { useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import { useSessionStore } from '../../stores/session';
import { useGraphStore } from '../../stores/graph';
import { useThemeStore } from '../../stores/theme';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useAnimationPhase } from '../../hooks/useAnimationPhase';
import { buildGraphFromDelibs } from '../../lib/buildGraph';
import { getGraphNodePositions, computeFocusedLayout } from '../../lib/layout';
import { agentColor } from '../../lib/color';
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
  const theme = useThemeStore((s) => s.activeTheme);
  const { fitView } = useReactFlow();
  // (prevActiveEdge removed — fitView now triggers on node count change instead)
  useAnimationPhase();

  // Build graph from the active delib (or all delibs if no active edge)
  const graph = useMemo(() => {
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

      return {
        id: np.id,
        type: 'agent' as const,
        position: { x: np.x / 100 * CANVAS_W, y: np.y / 100 * CANVAS_H },
        width: 110,
        height: 103,
        data: {
          agentId: np.id,
          totalMessages,
          activeGemots,
          agentIndex: graph.nodes.indexOf(np.id),
          agentCount: graph.nodes.length,
          isEdgeAgent,
          sideClass,
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

  // MiniMap node color based on agent color
  const miniMapNodeColor = useCallback((node: Node<AgentNodeData>) => {
    return agentColor(node.data.agentIndex, node.data.agentCount, theme);
  }, [theme]);

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={3}
          maskColor="rgba(0, 0, 0, 0.08)"
          className="graph-minimap"
          pannable
          zoomable
        />
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
      <CenterPanel />
    </div>
  );
}
