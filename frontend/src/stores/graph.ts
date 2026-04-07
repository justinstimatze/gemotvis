import { create } from 'zustand';
import type { AnimationPhase } from '../types';

interface GraphState {
  activeEdge: string | null;     // delibID of focused bilateral
  activeNode: string | null;     // agentID hovered or clicked
  clickedAgent: string | null;   // agentID explicitly clicked (triggers chat scroll)
  hoverEdge: string | null;      // delibID being hovered
  speakingAgent: string | null;  // agentID currently typing a message
  graphNodes: string[];          // sorted agent IDs in current graph (for color consistency)
  animationPhase: AnimationPhase;

  setActiveEdge: (edge: string | null) => void;
  setActiveNode: (node: string | null) => void;
  setClickedAgent: (agent: string | null) => void;
  setHoverEdge: (edge: string | null) => void;
  setSpeakingAgent: (agent: string | null) => void;
  setGraphNodes: (nodes: string[]) => void;
  setAnimationPhase: (phase: AnimationPhase) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  activeEdge: null,
  activeNode: null,
  clickedAgent: null,
  hoverEdge: null,
  speakingAgent: null,
  graphNodes: [],
  animationPhase: 'idle',

  setActiveEdge: (edge) => set({ activeEdge: edge }),
  setActiveNode: (node) => set({ activeNode: node }),
  setClickedAgent: (agent) => set({ clickedAgent: agent }),
  setHoverEdge: (edge) => set({ hoverEdge: edge }),
  setSpeakingAgent: (agent) => set({ speakingAgent: agent }),
  setGraphNodes: (nodes) => set({ graphNodes: nodes }),
  setAnimationPhase: (phase) => set({ animationPhase: phase }),
}));
