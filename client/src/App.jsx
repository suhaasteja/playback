import { useState, useRef, useEffect, useCallback } from 'react';
import Topbar from './components/Topbar';
import Timeline from './components/Timeline';
import DetailPanel from './components/DetailPanel';
import { parseAnyJSONL } from './utils/parseSession';
import './styles.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [steps, setSteps] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isMinimal, setIsMinimal] = useState(
    () => localStorage.getItem('minimalView') === 'true'
  );
  const [summary, setSummary] = useState('No summary yet.');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [stepContextSummary, setStepContextSummary] = useState('No contextual summary yet.');
  const [stepSummaryLoading, setStepSummaryLoading] = useState(false);
  const [stepSummaryError, setStepSummaryError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const timerRef = useRef(null);
  const speedRef = useRef(1);
  const currentIndexRef = useRef(0);
  const stepsRef = useRef([]);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { stepsRef.current = steps; }, [steps]);

  useEffect(() => {
    document.body.classList.toggle('is-minimal', isMinimal);
    localStorage.setItem('minimalView', isMinimal ? 'true' : 'false');
  }, [isMinimal]);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const goTo = useCallback((index) => {
    if (index < 0 || index >= stepsRef.current.length) return;
    setCurrentIndex(index);
    currentIndexRef.current = index;
    const ctxSummary = stepsRef.current[index]?.context_summary;
    setStepContextSummary(ctxSummary || 'No contextual summary yet.');
    setStepSummaryError(false);
  }, []);

  const pause = useCallback(() => { stopTimer(); setPlaying(false); }, []);

  const prev = useCallback(() => {
    goTo(Math.max(0, currentIndexRef.current - 1));
  }, [goTo]);

  const startTimer = useCallback((spd) => {
    const interval = 1500 / spd;
    timerRef.current = setInterval(() => {
      const n = currentIndexRef.current + 1;
      if (n >= stepsRef.current.length) { stopTimer(); setPlaying(false); return; }
      setCurrentIndex(n);
      currentIndexRef.current = n;
      const ctxSummary = stepsRef.current[n]?.context_summary;
      setStepContextSummary(ctxSummary || 'No contextual summary yet.');
    }, interval);
  }, []);

  const play = useCallback(() => {
    if (timerRef.current) return;
    startTimer(speedRef.current);
    setPlaying(true);
  }, [startTimer]);

  const next = useCallback(() => {
    const n = currentIndexRef.current + 1;
    if (n < stepsRef.current.length) goTo(n);
    else pause();
  }, [goTo, pause]);

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed);
    speedRef.current = newSpeed;
    if (timerRef.current) { stopTimer(); startTimer(newSpeed); }
  }, [startTimer]);

  const loadSession = useCallback((sess) => {
    pause();
    setSession(sess);
    const s = Array.isArray(sess.steps) ? sess.steps : [];
    setSteps(s);
    stepsRef.current = s;
    setSessionId(sess.id || null);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setSummary(sess.meta?.ai_summary || 'No summary yet.');
    setSummaryError(false);
    setSummaryLoading(false);
    setStepContextSummary('No contextual summary yet.');
    setStepSummaryError(false);
  }, [pause]);

  // Load session from URL or fall back to mock session
  useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'session' && parts[1]) {
      fetch(`/api/sessions/${parts[1]}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((sess) => { if (sess) loadSession(sess); })
        .catch(() => {});
    } else {
      fetch('/mock-session.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((sess) => { if (sess) loadSession(sess); })
        .catch(() => {});
    }
  }, [loadSession]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
      if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.code === 'KeyM') setIsMinimal((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, play, pause, next, prev]);

  const handleFileLoad = async (file) => {
    const text = await file.text();
    let sess;
    if (file.name.endsWith('.jsonl')) sess = parseAnyJSONL(text);
    else sess = JSON.parse(text);
    loadSession(sess);

    // Auto-upload to server so AI summary buttons work
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: sess.title, createdAt: sess.createdAt, steps: sess.steps }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session_id) setSessionId(data.session_id);
      }
    } catch { /* server not running — summary buttons will stay disabled */ }
  };

  // Drag and drop
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileLoad(file);
  };

  const handleGenerateSummary = async () => {
    if (!sessionId) { setSummary('Upload to server to generate a summary.'); setSummaryError(true); return; }
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/summary`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summary failed.');
      setSummary(data.summary || 'Summary unavailable.');
    } catch (err) {
      setSummary(err?.message || 'Summary failed.');
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleGenerateStepSummary = async () => {
    if (!sessionId) { setStepContextSummary('Upload to server to summarize a step.'); setStepSummaryError(true); return; }
    setStepSummaryLoading(true);
    setStepSummaryError(false);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/steps/${currentIndex}/context-summary`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summary failed.');
      const updated = [...stepsRef.current];
      if (updated[currentIndex]) updated[currentIndex] = { ...updated[currentIndex], context_summary: data.summary || '' };
      setSteps(updated);
      stepsRef.current = updated;
      setStepContextSummary(data.summary || 'Summary unavailable.');
    } catch (err) {
      setStepContextSummary(err?.message || 'Summary failed.');
      setStepSummaryError(true);
    } finally {
      setStepSummaryLoading(false);
    }
  };

  return (
    <div
      className={`app${isDragging ? ' is-dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Topbar
        session={session}
        speed={speed}
        onSpeedChange={changeSpeed}
        onFileLoad={handleFileLoad}
        isMinimal={isMinimal}
        onToggleMinimal={() => setIsMinimal((v) => !v)}
      />
      <main className="main">
        <Timeline
          steps={steps}
          currentIndex={currentIndex}
          playing={playing}
          speed={speed}
          session={session}
          onPlay={play}
          onPause={pause}
          onPrev={prev}
          onNext={next}
          onScrub={(i) => { pause(); goTo(i); }}
          onStepClick={(i) => { goTo(i); pause(); }}
          onFileLoad={handleFileLoad}
        />
        <DetailPanel
          steps={steps}
          currentIndex={currentIndex}
          sessionId={sessionId}
          summary={summary}
          summaryLoading={summaryLoading}
          summaryError={summaryError}
          stepContextSummary={stepContextSummary}
          stepSummaryLoading={stepSummaryLoading}
          stepSummaryError={stepSummaryError}
          onGenerateSummary={handleGenerateSummary}
          onGenerateStepSummary={handleGenerateStepSummary}
        />
      </main>
      {isDragging && <div className="drop-overlay"><span>Drop to load session</span></div>}
    </div>
  );
}
