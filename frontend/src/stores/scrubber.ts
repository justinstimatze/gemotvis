import { create } from 'zustand';
import type { TimelineEvent } from '../lib/buildTimeline';

const SPEEDS = [12000, 7000, 4000, 2000];
const SPEED_LABELS = ['1x', '2x', '3x', '5x'];

export type TypeFilter = 'position' | 'vote' | 'analysis' | null;

interface ScrubberState {
  enabled: boolean;
  playing: boolean;
  eventIndex: number | null;
  events: TimelineEvent[];
  speedIdx: number;
  typeFilter: TypeFilter;
  autoplayStarted: boolean;

  speed: number;
  speedLabel: string;

  setEvents: (events: TimelineEvent[]) => void;
  setEventIndex: (index: number | null) => void;
  setPlaying: (playing: boolean) => void;
  setAutoplayStarted: (started: boolean) => void;
  cycleSpeed: () => void;
  cycleFilter: () => void;
  reset: () => void;
}

export const useScrubberStore = create<ScrubberState>((set, get) => ({
  enabled: false,
  playing: false,
  eventIndex: null,
  events: [],
  speedIdx: 0,
  typeFilter: null,
  autoplayStarted: false,

  speed: SPEEDS[0]!,
  speedLabel: SPEED_LABELS[0]!,

  setEvents: (events) => set({ events }),
  setEventIndex: (index) => set({ eventIndex: index, enabled: index != null }),
  setPlaying: (playing) => set({ playing }),
  setAutoplayStarted: (started) => set({ autoplayStarted: started }),

  cycleSpeed: () => {
    const next = (get().speedIdx + 1) % SPEEDS.length;
    set({ speedIdx: next, speed: SPEEDS[next]!, speedLabel: SPEED_LABELS[next]! });
  },

  cycleFilter: () => {
    const filters: TypeFilter[] = [null, 'position', 'vote', 'analysis'];
    const current = get().typeFilter;
    const idx = filters.indexOf(current);
    const next = filters[(idx + 1) % filters.length]!;
    set({ typeFilter: next });
  },

  reset: () =>
    set({
      enabled: false,
      playing: false,
      eventIndex: null,
      events: [],
      autoplayStarted: false,
    }),
}));
