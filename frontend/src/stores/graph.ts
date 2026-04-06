import { create } from 'zustand';
import type { AnimationPhase } from '../types';

interface GraphState {
  activeEdge: string | null;     // delibID of focused bilateral
  activeNode: string | null;     // agentID if viewing group delib from a node
  hoverEdge: string | null;      // delibID being hovered
  animationPhase: AnimationPhase;

  setActiveEdge: (edge: string | null) => void;
  setActiveNode: (node: string | null) => void;
  setHoverEdge: (edge: string | null) => void;
  setAnimationPhase: (phase: AnimationPhase) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  activeEdge: null,
  activeNode: null,
  hoverEdge: null,
  animationPhase: 'idle',

  setActiveEdge: (edge) => set({ activeEdge: edge }),
  setActiveNode: (node) => set({ activeNode: node }),
  setHoverEdge: (edge) => set({ hoverEdge: edge }),
  setAnimationPhase: (phase) => set({ animationPhase: phase }),
}));
