import { useEffect } from 'react';
import { useScrubberStore } from '../stores/scrubber';
import { useGraphStore } from '../stores/graph';
import { useSessionStore } from '../stores/session';
import { buildGraphFromDelibs } from '../lib/buildGraph';

/**
 * Global keyboard shortcuts for scrubber control:
 *   Space      — play/pause
 *   ArrowRight — advance one event
 *   ArrowLeft  — go back one event
 *   S          — skip to next deliberation
 *   Tab        — cycle to next agent's bilateral (multi-delib)
 *   Shift+Tab  — cycle to previous agent's bilateral
 *   1-4        — set speed (1x, 2x, 3x, 5x)
 *   F          — cycle filter (ALL → position → vote → analysis)
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't capture when typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const scrub = useScrubberStore.getState();
      const graph = useGraphStore.getState();

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          if (scrub.playing) {
            scrub.setPlaying(false);
          } else {
            scrub.setPlaying(true);
          }
          break;
        }

        case 'ArrowRight': {
          e.preventDefault();
          const next = Math.min((scrub.eventIndex ?? -1) + 1, scrub.events.length - 1);
          scrub.setEventIndex(next);
          const evt = scrub.events[next];
          if (evt) graph.setActiveEdge(evt.delibID);
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          const prev = Math.max((scrub.eventIndex ?? 0) - 1, 0);
          scrub.setEventIndex(prev);
          const evt = scrub.events[prev];
          if (evt) graph.setActiveEdge(evt.delibID);
          break;
        }

        case 's':
        case 'S': {
          // Skip to next deliberation
          const idx = scrub.eventIndex;
          if (idx == null || scrub.events.length === 0) break;
          const currentDelibID = scrub.events[idx]?.delibID;
          let next = idx + 1;
          while (next < scrub.events.length && scrub.events[next]?.delibID === currentDelibID) next++;
          if (next < scrub.events.length) {
            const evt = scrub.events[next]!;
            graph.setActiveEdge(evt.delibID);
            scrub.setEventIndex(next);
          }
          break;
        }

        case 'f':
        case 'F': {
          scrub.cycleFilter();
          break;
        }

        case 'Tab': {
          e.preventDefault();
          const delibs = useSessionStore.getState().deliberations;
          const g = buildGraphFromDelibs(delibs);
          if (g.nodes.length < 2) break;

          // Find current highlighted agent, cycle to next/prev
          const currentNode = graph.activeNode;
          const currentIdx = currentNode ? g.nodes.indexOf(currentNode) : -1;
          const dir = e.shiftKey ? -1 : 1;
          const nextIdx = (currentIdx + dir + g.nodes.length) % g.nodes.length;
          const nextAgent = g.nodes[nextIdx]!;

          graph.setActiveNode(nextAgent);

          // In multi-delib, also focus that agent's first bilateral
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
          break;
        }

        case '1': scrub.setSpeedByIndex(0); break;
        case '2': scrub.setSpeedByIndex(1); break;
        case '3': scrub.setSpeedByIndex(2); break;
        case '4': scrub.setSpeedByIndex(3); break;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}
