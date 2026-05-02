import { Clapperboard, Upload, Minimize2, Maximize2, Gauge } from 'lucide-react';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Topbar({
  session,
  speed,
  onSpeedChange,
  onFileLoad,
  isMinimal,
  onToggleMinimal,
}) {
  const sessionTitle = session?.title;
  const createdAt = session?.createdAt ? formatDate(session.createdAt) : '';
  const sessionLabel = [sessionTitle, createdAt].filter(Boolean).join(' · ');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (file) onFileLoad(file);
    e.target.value = '';
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <Clapperboard size={14} strokeWidth={2.5} />
        </div>
        <span className="title">Playback</span>
        {sessionLabel && (
          <>
            <span className="brand-sep">/</span>
            <span className="subtitle">{sessionLabel}</span>
          </>
        )}
      </div>

      <div className="controls">
        <label className="speed">
          <Gauge size={13} />
          <select value={speed} onChange={(e) => onSpeedChange(parseFloat(e.target.value))}>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <label className="file" title="Load a .json or .jsonl session file">
          <Upload size={13} />
          Load file
          <input type="file" accept=".json,.jsonl" onChange={handleFile} />
        </label>
        <button onClick={onToggleMinimal} title={isMinimal ? 'Exit minimal view (M)' : 'Minimal view (M)'}>
          {isMinimal ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
        </button>
      </div>
    </header>
  );
}
