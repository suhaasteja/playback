import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';

function pad(n) {
  return String(n).padStart(2, '0');
}

function computeTimecode(steps, currentIndex) {
  const first = steps?.[0]?.timestamp;
  const current = steps?.[currentIndex]?.timestamp;
  if (first && current) {
    const ms = new Date(current) - new Date(first);
    if (!isNaN(ms) && ms >= 0) {
      const totalSecs = Math.floor(ms / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const centis = Math.floor((ms % 1000) / 10);
      return `${pad(mins)}:${pad(secs)}:${pad(centis)}`;
    }
  }
  const seconds = Math.floor(currentIndex * 1.5);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const frames = Math.floor((currentIndex * 12) % 100);
  return `${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}

export default function TapeDeck({
  steps,
  playing,
  speed,
  currentIndex,
  totalSteps,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onScrub,
}) {
  const timeCode = computeTimecode(steps, currentIndex);

  return (
    <div className="playback-strip">
      <div className="transport">
        <button className="t-btn" title="Previous (←)" onClick={onPrev}>
          <SkipBack size={12} strokeWidth={2} />
        </button>
        <button
          className={`t-btn${playing ? ' is-playing' : ''}`}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={playing ? onPause : onPlay}
        >
          {playing ? <Pause size={12} strokeWidth={2} /> : <Play size={12} strokeWidth={2} />}
        </button>
        <button className="t-btn" title="Next (→)" onClick={onNext}>
          <SkipForward size={12} strokeWidth={2} />
        </button>
      </div>

      <span className="timecode">{timeCode}</span>

      <input
        className="scrub-slider"
        type="range"
        min={0}
        max={totalSteps > 0 ? totalSteps - 1 : 0}
        value={currentIndex}
        onChange={(e) => onScrub(parseInt(e.target.value, 10))}
      />

      <span className="step-counter">
        {totalSteps ? currentIndex + 1 : 0} / {totalSteps}
      </span>

      <span className="speed-badge">{speed}×</span>
    </div>
  );
}
