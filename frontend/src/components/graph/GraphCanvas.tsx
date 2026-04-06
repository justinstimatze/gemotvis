import { useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import { useSessionStore } from '../../stores/session';
import { useGraphStore } from '../../stores/graph';
import { useScrubberStore } from '../../stores/scrubber';
import { useFilteredState } from '../../hooks/useFilteredState';
import { useAnimationPhase } from '../../hooks/useAnimationPhase';
import { useRFNodes, useRFEdges } from '../../hooks/useGraphData';
import { buildGraphFromDelibs } from '../../lib/buildGraph';
import { getGraphNodePositions, computeFocusedLayout } from '../../lib/layout';
import { AgentNode, type AgentNodeData } from './AgentNode';
import { DelibEdge } from './DelibEdge';
import { CenterPanel } from './CenterPanel';
import { WorldMap } from './WorldMap';

const nodeTypes = { agent: AgentNode };
const edgeTypes = { delib: DelibEdge };

function GraphCanvasInner() {
  const rawDelibs = useSessionStore((s) => s.deliberations);
  const filteredDelibs = useFilteredState();
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const { fitView } = useReactFlow();
  useAnimationPhase();

  // Build graph structure from deliberations
  const graph = useMemo(() => {
    const bilateralCount = Object.values(rawDelibs).filter(d => d.agents?.length === 2).length;
    if (bilateralCount > 1) return buildGraphFromDelibs(rawDelibs);
    const delibs = activeEdge && rawDelibs[activeEdge]
      ? { [activeEdge]: rawDelibs[activeEdge] }
      : rawDelibs;
    return buildGraphFromDelibs(delibs);
  }, [rawDelibs, activeEdge]);

  // Compute and apply layout
  const layoutResult = useMemo(() => getGraphNodePositions(graph, rawDelibs), [graph, rawDelibs]);

  const nodePositions = useMemo(() => {
    if (!activeEdge) return layoutResult.positions;
    const uniqueDelibIDs = new Set(graph.edges.map(e => e.delibID));
    if (uniqueDelibIDs.size <= 1) return layoutResult.positions;
    const edge = graph.edges.find(e => e.delibID === activeEdge);
    if (edge) return computeFocusedLayout(layoutResult.positions, edge.a, edge.b);
    return layoutResult.positions;
  }, [layoutResult.positions, activeEdge, graph.edges]);

  // Build React Flow data
  const rfNodes = useRFNodes(nodePositions, graph, filteredDelibs, activeEdge);
  const rfEdges = useRFEdges(graph, filteredDelibs, activeEdge);

  // fitView on node count change
  const prevNodeCount = useRef(rfNodes.length);
  useEffect(() => {
    if (rfNodes.length !== prevNodeCount.current) {
      prevNodeCount.current = rfNodes.length;
      const timer = setTimeout(() => fitView({ padding: 0.35, duration: 600 }), 150);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, fitView]);

  // Node hover → highlight connected edges
  const setActiveNode = useGraphStore((s) => s.setActiveNode);
  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node<AgentNodeData>) => {
    setActiveNode(node.data.agentId);
  }, [setActiveNode]);
  const onNodeMouseLeave = useCallback(() => {
    setActiveNode(null);
  }, [setActiveNode]);

  // Node click → cycle through agent's bilaterals
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node<AgentNodeData>) => {
    const agentId = node.data.agentId;
    const agentEdges = graph.edges
      .filter(e => e.a === agentId || e.b === agentId)
      .map(e => ({ delibID: e.delibID, posCount: (rawDelibs[e.delibID]?.positions ?? []).length }))
      .filter(e => e.posCount > 0)
      .sort((a, b) => b.posCount - a.posCount);

    if (agentEdges.length === 0) return;

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
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
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
      <CenterPanel />
    </div>
  );
}
