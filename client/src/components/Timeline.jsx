import { useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import TapeDeck from './TapeDeck';

function truncate(text, len = 120) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len - 3) + '...' : text;
}

function ToolPills({ tools }) {
  if (!tools?.length) return <span className="muted" style={{ fontSize: 11 }}>(none)</span>;
  const visible = tools.slice(0, 3);
  const extra = tools.length - visible.length;
  return (
    <div className="tool-pills">
      {visible.map((t, i) => (
        <span key={i} className={`tool-pill ${t.status === 'ok' ? 'ok' : 'pending'}`}>
          {t.name || '(tool)'}
        </span>
      ))}
      {extra > 0 && <span className="tool-pill-more">+{extra}</span>}
    </div>
  );
}

function TimelineRow({ step, index, isActive, onClick }) {
  return (
    <div
      className={`lane-row${isActive ? ' active' : ''}`}
      data-index={index}
      style={{ '--i': index }}
      onClick={onClick}
    >
      <div className="step-num">{index + 1}</div>
      <div className="cell user">{truncate(step.user_text || '(no user text)')}</div>
      <div className="cell agent">{truncate(step.agent_summary || step.reasoning_summary || '')}</div>
      <div className="cell tools"><ToolPills tools={step.tools} /></div>
      <div className="cell output">{truncate(step.agent_output || '')}</div>
    </div>
  );
}

function EmptyState({ onFileLoad }) {
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (file) onFileLoad(file);
    e.target.value = '';
  }

  return (
    <div className="empty-state">
      <Upload size={28} strokeWidth={1.5} />
      <div className="empty-state-title">No session loaded</div>
      <div className="empty-state-sub">Drop a .json or .jsonl file here, or click to browse</div>
      <label className="empty-state-btn">
        Browse file
        <input type="file" accept=".json,.jsonl" onChange={handleFile} />
      </label>
    </div>
  );
}

export default function Timeline({
  steps,
  currentIndex,
  playing,
  speed,
  session,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onScrub,
  onStepClick,
  onFileLoad,
}) {
  const rowsRef = useRef(null);

  useEffect(() => {
    const container = rowsRef.current;
    if (!container) return;
    const activeRow = container.querySelector(`.lane-row[data-index="${currentIndex}"]`);
    if (!activeRow) return;
    const rowTop = activeRow.offsetTop;
    const rowBottom = rowTop + activeRow.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (rowTop < viewTop + 8) {
      container.scrollTo({ top: Math.max(0, rowTop - 8), behavior: 'smooth' });
    } else if (rowBottom > viewBottom - 8) {
      container.scrollTo({ top: rowBottom - container.clientHeight + 8, behavior: 'smooth' });
    }
  }, [currentIndex]);

  return (
    <section className="timeline">
      <TapeDeck
        steps={steps}
        playing={playing}
        speed={speed}
        currentIndex={currentIndex}
        totalSteps={steps.length}
        onPlay={onPlay}
        onPause={onPause}
        onPrev={onPrev}
        onNext={onNext}
        onScrub={onScrub}
      />
      <div className="lane-header">
        <div />
        <div className="lane-title"><span className="lane-dot user" />User</div>
        <div className="lane-title"><span className="lane-dot agent" />Agent</div>
        <div className="lane-title"><span className="lane-dot tools" />Tools</div>
        <div className="lane-title"><span className="lane-dot output" />Output</div>
      </div>
      <div className="lane-rows" ref={rowsRef}>
        {steps.length === 0
          ? <EmptyState onFileLoad={onFileLoad} />
          : steps.map((step, index) => (
              <TimelineRow
                key={step.id || index}
                step={step}
                index={index}
                isActive={index === currentIndex}
                onClick={() => onStepClick(index)}
              />
            ))
        }
      </div>
    </section>
  );
}
