import { useCallback } from 'react';
import { useScrubberStore } from '../../stores/scrubber';
import { useGraphStore } from '../../stores/graph';
import { useScrubberPlayback } from '../../hooks/useScrubberPlayback';

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

  const { startPlayback, stopPlayback, skipForward } = useScrubberPlayback();

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else startPlayback();
  }, [playing, startPlayback, stopPlayback]);

  const scrubTo = useCallback((index: number) => {
    setEventIndex(index);
    const evt = events[index];
    if (evt) setActiveEdge(evt.delibID);
  }, [events, setEventIndex, setActiveEdge]);

  const filterLabel = typeFilter ? typeFilter.toUpperCase() : 'ALL';

  if (events.length === 0) return null;

  return (
    <div className="scrubber-bar" id="scrubber-bar">
      <button className="scrubber-btn scrubber-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
        {playing ? '\u23F8' : '\u25B6'}
      </button>
      <button className="scrubber-btn" onClick={cycleSpeed} title="Speed">
        {speedLabel}
      </button>
      <button className="scrubber-btn" onClick={cycleFilter} title="Filter">
        {filterLabel}
      </button>

      <div className="scrubber-track">
        {events.map((evt, i) => {
          if (typeFilter && evt.type !== typeFilter) return null;
          const isActive = eventIndex === i;
          const isPast = eventIndex != null && i <= eventIndex;
          return (
            <button
              key={i}
              className={`scrubber-dot ${evt.type} ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
              title={evt.label}
              onClick={() => scrubTo(i)}
            />
          );
        })}
      </div>

      <button className="scrubber-btn" onClick={skipForward} title="Skip to next conversation">
        {'\u23ED'}
      </button>

      <span className="scrubber-label">
        {eventIndex != null && events[eventIndex]
          ? events[eventIndex].label
          : 'Ready'}
      </span>
    </div>
  );
}
