import { useCallback, useMemo } from 'react';
import { useScrubberStore } from '../../stores/scrubber';
import { useGraphStore } from '../../stores/graph';
import { useSessionStore } from '../../stores/session';
import { startPlaybackAction, stopPlaybackAction, skipForwardAction } from '../../hooks/useScrubberPlayback';
import { truncate } from '../../lib/helpers';

export function ScrubberBar() {
  const events = useScrubberStore((s) => s.events);
  const eventIndex = useScrubberStore((s) => s.eventIndex);
  const playing = useScrubberStore((s) => s.playing);
  const speedLabel = useScrubberStore((s) => s.speedLabel);
  const typeFilter = useScrubberStore((s) => s.typeFilter);
  const cycleSpeed = useScrubberStore((s) => s.cycleSpeed);
  const cycleFilter = useScrubberStore((s) => s.cycleFilter);
  const setEventIndex = useScrubberStore((s) => s.setEventIndex);
  const setActiveEdge = useGraphStore((s) => s.setActiveEdge);

  const togglePlay = useCallback(() => {
    if (playing) stopPlaybackAction();
    else startPlaybackAction();
  }, [playing]);

  const scrubTo = useCallback((index: number) => {
    setEventIndex(index);
    const evt = events[index];
    if (evt) setActiveEdge(evt.delibID);
  }, [events, setEventIndex, setActiveEdge]);

  // Click on progress bar to scrub
  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(pct * (events.length - 1));
    scrubTo(Math.max(0, Math.min(events.length - 1, idx)));
  }, [events.length, scrubTo]);

  const filterLabel = typeFilter ? typeFilter.toUpperCase() : 'ALL';
  const progress = events.length > 0 && eventIndex != null
    ? ((eventIndex + 1) / events.length) * 100
    : 0;

  // Count events by type for the progress indicator
  const counts = useMemo(() => {
    let positions = 0, votes = 0, analysis = 0;
    for (const e of events) {
      if (e.type === 'position') positions++;
      else if (e.type === 'vote') votes++;
      else if (e.type === 'analysis') analysis++;
    }
    return { positions, votes, analysis, total: events.length };
  }, [events]);

  // Compute density per marker (events within ±2% of timeline position)
  const density = useMemo(() => {
    if (events.length < 2) return events.map(() => 1);
    const n = events.length;
    const window = Math.max(2, Math.floor(n * 0.04)); // 4% window
    return events.map((_, i) => {
      const lo = Math.max(0, i - window);
      const hi = Math.min(n - 1, i + window);
      return (hi - lo + 1) / (window * 2 + 1);
    });
  }, [events]);

  const currentLabel = eventIndex != null && events[eventIndex]
    ? events[eventIndex].label
    : '';

  // Unique deliberations in timeline order (for delib picker)
  const activeEdge = useGraphStore((s) => s.activeEdge);
  const deliberations = useSessionStore((s) => s.deliberations);
  const delibList = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; topic: string; firstIdx: number }[] = [];
    for (let i = 0; i < events.length; i++) {
      const id = events[i]!.delibID;
      if (!seen.has(id)) {
        seen.add(id);
        const ds = deliberations[id];
        const topic = ds?.deliberation?.topic ?? id;
        const agentCount = ds?.agents?.length ?? 0;
        const suffix = agentCount > 0 ? ` (${agentCount})` : '';
        list.push({ id, topic: truncate(topic, 22) + suffix, firstIdx: i });
      }
    }
    return list;
  }, [events, deliberations]);

  const setPlaying = useScrubberStore((s) => s.setPlaying);
  const jumpToDelib = useCallback((delibId: string, firstIdx: number) => {
    setPlaying(false);
    setEventIndex(firstIdx);
    setActiveEdge(delibId);
  }, [setPlaying, setEventIndex, setActiveEdge]);

  if (events.length === 0) return null;

  return (
    <div className="scrubber-bar" id="scrubber-bar">
      {/* Deliberation picker — only show when multiple delibs */}
      {delibList.length > 1 && (
        <div className="scrubber-delib-nav">
          {delibList.map((d) => (
            <button
              key={d.id}
              className={`scrubber-delib-pill ${activeEdge === d.id ? 'active' : ''}`}
              onClick={() => jumpToDelib(d.id, d.firstIdx)}
              title={deliberations[d.id]?.deliberation?.topic ?? d.id}
            >
              {d.topic}
            </button>
          ))}
        </div>
      )}
      {/* Controls */}
      <div className="scrubber-controls">
        <button className="scrubber-btn scrubber-play" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause playback' : 'Start playback'}>
          {playing ? '\u23F8' : '\u25B6'}
        </button>
        <button className="scrubber-btn" onClick={skipForwardAction} title="Skip to next conversation (S)" aria-label="Skip to next conversation">
          {'\u23ED'}
        </button>
        <button className="scrubber-btn scrubber-speed" onClick={cycleSpeed} title="Speed (1-4)">
          {speedLabel}
        </button>
        <button className="scrubber-btn scrubber-filter" onClick={cycleFilter} title="Filter (F)">
          {filterLabel}
        </button>
      </div>

      {/* Progress track with clickable bar */}
      <div className="scrubber-track-wrapper">
        <div className="scrubber-track" onClick={handleTrackClick}>
          <div className="scrubber-progress" style={{ width: `${progress}%` }} />
          {/* Event markers on the track */}
          {events.map((evt, i) => {
            if (typeFilter && evt.type !== typeFilter) return null;
            const pct = (i / Math.max(events.length - 1, 1)) * 100;
            const isActive = eventIndex === i;
            return (
              <div
                key={i}
                className={`scrubber-marker ${evt.type} ${isActive ? 'active' : ''}`}
                style={{ left: `${pct}%`, opacity: 0.4 + (density[i] ?? 0.5) * 0.6 }}
                title={evt.label}
              />
            );
          })}
        </div>
        {/* Current event label */}
        <div className="scrubber-info">
          <span className="scrubber-label">{currentLabel}</span>
          <span className="scrubber-counter">
            {eventIndex != null ? eventIndex + 1 : 0}/{counts.total}
          </span>
        </div>
      </div>
    </div>
  );
}
