import { useState } from 'react';
import { Sparkles, Clipboard, Check, ChevronDown, ChevronRight, Loader } from 'lucide-react';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button className="copy-btn" onClick={handleCopy} title="Copy">
      {copied ? <Check size={11} /> : <Clipboard size={11} />}
    </button>
  );
}

function DetailBlock({ labelClass, label, text, children }) {
  if (!text && !children) return null;
  return (
    <div className="detail-block">
      <div className={`detail-label ${labelClass}`}>
        <span className="detail-dot" />
        {label}
        {text && <CopyButton text={text} />}
      </div>
      <div className="detail-text">{children || text}</div>
    </div>
  );
}

function ToolRow({ tool }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="tool-row">
      <div className="tool-row-header" onClick={() => setExpanded((v) => !v)}>
        <span className={`tool-status-badge ${tool.status}`}>{tool.status}</span>
        <span className="tool-row-name">{tool.name || '(tool)'}</span>
        <span className="tool-row-chevron">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </div>
      {expanded && (
        <div className="tool-row-body">
          {tool.arguments && (
            <div className="tool-row-field">
              <span className="tool-row-field-label">Args</span>
              <pre className="tool-row-field-value">{tool.arguments}</pre>
              <CopyButton text={tool.arguments} />
            </div>
          )}
          {tool.output && (
            <div className="tool-row-field">
              <span className="tool-row-field-label">Output</span>
              <pre className="tool-row-field-value">{tool.output}</pre>
              <CopyButton text={tool.output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExpandableText({ text, limit = 300 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  if (text.length <= limit) return <span>{text}</span>;
  return (
    <span>
      {expanded ? text : text.slice(0, limit) + '…'}
      <button className="expand-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'less' : 'more'}
      </button>
    </span>
  );
}

function SummaryLoading() {
  return (
    <div className="summary-loading">
      <Loader size={13} className="spin" /> Generating…
    </div>
  );
}

export default function DetailPanel({
  steps,
  currentIndex,
  sessionId,
  summary,
  summaryLoading,
  summaryError,
  stepContextSummary,
  stepSummaryLoading,
  stepSummaryError,
  onGenerateSummary,
  onGenerateStepSummary,
}) {
  const step = steps[currentIndex];

  return (
    <aside className="detail">

      {/* E2: Step details — shown first */}
      <div className="panel-section">
        <div className="panel-section-title">
          {step ? `Step ${currentIndex + 1} of ${steps.length}` : 'Step details'}
        </div>

        {!step ? (
          <div className="detail-body">Load a session to begin.</div>
        ) : (
          <>
            <DetailBlock labelClass="user" label="User" text={step.user_text} />
            <DetailBlock labelClass="agent" label="Agent" text={step.agent_summary} />
            {step.reasoning_summary && (
              <DetailBlock labelClass="reason" label="Reasoning" text={step.reasoning_summary} />
            )}
            {step.tools?.length > 0 && (
              <div className="detail-block">
                <div className="detail-label tools">
                  <span className="detail-dot" />
                  Tools ({step.tools.length})
                </div>
                <div className="detail-text">
                  {step.tools.map((t, i) => <ToolRow key={i} tool={t} />)}
                </div>
              </div>
            )}
            {step.agent_output && (
              <div className="detail-block">
                <div className="detail-label output">
                  <span className="detail-dot" />
                  Output
                  <CopyButton text={step.agent_output} />
                </div>
                <div className="detail-text">
                  <ExpandableText text={step.agent_output} />
                </div>
              </div>
            )}
          </>
        )}

        {stepSummaryLoading
          ? <SummaryLoading />
          : <div className={`detail-body${stepSummaryError ? ' summary-error' : ''}`} style={{ marginTop: 8 }}>
              {stepContextSummary}
            </div>
        }
        <button
          className="summary-btn"
          disabled={stepSummaryLoading}
          onClick={onGenerateStepSummary}
          title={!sessionId ? 'Upload to server to enable AI summaries' : 'Summarize this step in context'}
        >
          <Sparkles size={12} />
          {stepSummaryLoading ? 'Summarizing…' : 'Summarize step'}
        </button>
      </div>

      {/* E1: Session summary */}
      <div className="panel-section">
        <div className="panel-section-title">Session summary</div>
        {summaryLoading
          ? <SummaryLoading />
          : <div className={`detail-body${summaryError ? ' summary-error' : ''}`}>{summary}</div>
        }
        <button
          className="summary-btn"
          disabled={summaryLoading}
          onClick={onGenerateSummary}
          title={!sessionId ? 'Upload to server to enable AI summaries' : 'Generate AI summary'}
        >
          <Sparkles size={12} />
          {summaryLoading ? 'Generating…' : 'Generate summary'}
        </button>
      </div>

    </aside>
  );
}
