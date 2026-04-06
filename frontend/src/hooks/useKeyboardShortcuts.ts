import { useEffect } from 'react';
import { useScrubberStore } from '../stores/scrubber';
import { useGraphStore } from '../stores/graph';
import { useSessionStore } from '../stores/session';
import { buildGraphFromDelibs } from '../lib/buildGraph';

type Stores = {
  scrub: ReturnType<typeof useScrubberStore.getState>;
  graph: ReturnType<typeof useGraphStore.getState>;
};

function handlePlayPause({ scrub }: Stores) {
  scrub.setPlaying(!scrub.playing);
}

function handleStepRight({ scrub, graph }: Stores) {
  const next = Math.min((scrub.eventIndex ?? -1) + 1, scrub.events.length - 1);
  scrub.setEventIndex(next);
  const evt = scrub.events[next];
  if (evt) graph.setActiveEdge(evt.delibID);
}

function handleStepLeft({ scrub, graph }: Stores) {
  const prev = Math.max((scrub.eventIndex ?? 0) - 1, 0);
  scrub.setEventIndex(prev);
  const evt = scrub.events[prev];
  if (evt) graph.setActiveEdge(evt.delibID);
}

function handleSkipDelib({ scrub, graph }: Stores) {
  const idx = scrub.eventIndex;
  if (idx == null || scrub.events.length === 0) return;
  const currentDelibID = scrub.events[idx]?.delibID;
  let next = idx + 1;
  while (next < scrub.events.length && scrub.events[next]?.delibID === currentDelibID) next++;
  if (next < scrub.events.length) {
    const evt = scrub.events[next]!;
    graph.setActiveEdge(evt.delibID);
    scrub.setEventIndex(next);
  }
}

function handleTabCycle({ scrub, graph }: Stores, shiftKey: boolean) {
  const delibs = useSessionStore.getState().deliberations;
  const g = buildGraphFromDelibs(delibs);
  if (g.nodes.length < 2) return;

  const currentIdx = graph.activeNode ? g.nodes.indexOf(graph.activeNode) : -1;
  const dir = shiftKey ? -1 : 1;
  const nextIdx = (currentIdx + dir + g.nodes.length) % g.nodes.length;
  const nextAgent = g.nodes[nextIdx]!;

  graph.setActiveNode(nextAgent);

  const agentEdge = g.edges.find(edge =>
    (edge.a === nextAgent || edge.b === nextAgent) &&
    (delibs[edge.delibID]?.positions?.length ?? 0) > 0
  );
  if (agentEdge) {
    scrub.setPlaying(false);
    graph.setActiveEdge(agentEdge.delibID);
    const idx = scrub.events.findIndex(ev => ev.delibID === agentEdge.delibID);
    if (idx >= 0) scrub.setEventIndex(idx);
  }
}

function handleSearch(e: KeyboardEvent) {
  const searchInput = document.querySelector('.center-search-input') as HTMLInputElement;
  const searchBtn = document.querySelector('.center-search-btn') as HTMLButtonElement;
  if (searchInput) {
    e.preventDefault();
    searchInput.focus();
  } else if (searchBtn) {
    e.preventDefault();
    searchBtn.click();
  }
}

/**
 * Global keyboard shortcuts:
 *   Space      — play/pause
 *   Arrow R/L  — step forward/back
 *   S          — skip to next deliberation
 *   Tab        — cycle agents (Shift+Tab = reverse)
 *   /          — open search
 *   F          — cycle event filter
 *   1-4        — set speed
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const stores: Stores = {
        scrub: useScrubberStore.getState(),
        graph: useGraphStore.getState(),
      };

      switch (e.key) {
        case ' ':       e.preventDefault(); handlePlayPause(stores); break;
        case 'ArrowRight': e.preventDefault(); handleStepRight(stores); break;
        case 'ArrowLeft':  e.preventDefault(); handleStepLeft(stores); break;
        case 's': case 'S': handleSkipDelib(stores); break;
        case 'f': case 'F': stores.scrub.cycleFilter(); break;
        case 'Tab':     e.preventDefault(); handleTabCycle(stores, e.shiftKey); break;
        case '/':       handleSearch(e); break;
        case '1':       stores.scrub.setSpeedByIndex(0); break;
        case '2':       stores.scrub.setSpeedByIndex(1); break;
        case '3':       stores.scrub.setSpeedByIndex(2); break;
        case '4':       stores.scrub.setSpeedByIndex(3); break;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}
