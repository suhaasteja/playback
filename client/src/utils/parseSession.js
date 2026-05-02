// ── Utilities ─────────────────────────────────────────────────────────────────

export function extractContentText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') return item.text;
          if (typeof item.output_text === 'string') return item.output_text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

// ── Old format parser (event_msg / response_item) ─────────────────────────────

export function parseJSONL(text) {
  const steps = [];
  let current = null;
  let stepIndex = 0;
  const callIndex = new Map();
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    const topType = obj.type;
    const payload = obj.payload || {};

    if (topType === 'event_msg' && payload.type === 'user_message') {
      if (current) steps.push(current);
      stepIndex += 1;
      current = {
        id: `t${stepIndex}`,
        timestamp: obj.timestamp || payload.timestamp || '',
        user_text: payload.message || payload.text || '',
        agent_summary: '', reasoning_summary: '', agent_output: '', tools: [],
      };
      continue;
    }
    if (!current) continue;
    if (topType === 'event_msg' && payload.type === 'agent_message') {
      if (!current.agent_summary && payload.message) current.agent_summary = payload.message;
      continue;
    }
    if (topType === 'response_item') {
      const ptype = payload.type;
      if (ptype === 'message') {
        current.agent_output += extractContentText(payload.content || payload.text || '');
      } else if (ptype === 'reasoning') {
        if (!current.reasoning_summary && Array.isArray(payload.summary)) {
          const entry = payload.summary.find((s) => s && (s.summary_text || s.text));
          current.reasoning_summary = (entry && (entry.summary_text || entry.text)) || '';
        }
      } else if (ptype === 'function_call') {
        const tool = { name: payload.name || '', arguments: payload.arguments || '', call_id: payload.call_id || '', output: '', status: 'pending' };
        current.tools.push(tool);
        if (tool.call_id) callIndex.set(tool.call_id, current.tools.length - 1);
      } else if (ptype === 'function_call_output') {
        const idx = callIndex.get(payload.call_id || '');
        if (idx !== undefined && current.tools[idx]) {
          current.tools[idx].output = payload.output || '';
          current.tools[idx].status = 'ok';
        }
      }
    }
  }
  if (current) steps.push(current);
  return { title: 'Playback', createdAt: new Date().toISOString(), steps };
}

// ── Claude Code JSONL parser ───────────────────────────────────────────────────
//
// Format produced by Claude Code CLI at ~/.claude/projects/<dir>/<uuid>.jsonl
//
// Each line is one of:
//   { type: "user",      message: { role: "user",      content: string | Block[] } }
//   { type: "assistant", message: { role: "assistant", content: Block[], stop_reason, usage, model } }
//   { type: "system" | "progress" | "file-history-snapshot" | ... }  ← ignored
//
// Assistant content blocks:
//   { type: "thinking", thinking: string, signature: string }
//   { type: "text",     text: string }
//   { type: "tool_use", id: string, name: string, input: object }
//
// User content blocks (when content is an array):
//   { type: "tool_result", tool_use_id: string, content: string | Block[], is_error: bool }
//   { type: "text", text: string }
//
// Conversation structure per "step":
//   user (real text message)
//   assistant (tool_use, stop_reason:"tool_use")  ← may repeat N times
//   user (tool_result blocks)                      ← paired with above
//   assistant (text, stop_reason:"end_turn")       ← final answer

// Tags injected by Claude Code's shell integration and slash-command system.
// Messages whose content starts with one of these are not real human turns.
const SYSTEM_TAG_RE = /^<(bash-input|bash-stdout|bash-stderr|command-name|command-message|command-args|local-command-stdout|local-command-caveat|anonymous)[^>]*>/;

function isRealUserMessage(entry) {
  if (entry.type !== 'user' || entry.isMeta) return false;
  const content = entry.message?.content;
  // string content = plain human message, unless it's a system-injected XML tag
  if (typeof content === 'string') {
    return content.trim().length > 0 && !SYSTEM_TAG_RE.test(content.trim());
  }
  // array with only text blocks (not tool_result) = also human message
  if (Array.isArray(content)) {
    return content.length > 0 && content.every((b) => b.type === 'text' || typeof b === 'string');
  }
  return false;
}

function isToolResultMessage(entry) {
  if (entry.type !== 'user') return false;
  const content = entry.message?.content;
  return Array.isArray(content) && content.some((b) => b.type === 'tool_result');
}

function extractToolResultText(block) {
  // block.content can be string or array of text blocks
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) return block.content.map((b) => b.text || '').join('');
  return '';
}

function serializeToolInput(input) {
  if (!input) return '';
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

function slugToTitle(slug) {
  if (!slug) return '';
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function parseClaudeJSONL(text) {
  // 1. Parse all lines
  const raw = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { raw.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  // 2. Keep only user + assistant entries on the main chain (not subagents)
  const convo = raw.filter(
    (e) => (e.type === 'user' || e.type === 'assistant') && !e.isSidechain
  );

  // 3. Deduplicate assistant entries by message.id.
  //    Claude Code stores streaming intermediate states (stop_reason: null)
  //    alongside the final complete entry (stop_reason: "tool_use"|"end_turn").
  //    We keep only the complete version for each message.id.
  const seenMsgIds = new Map(); // msgId → index in deduped array
  const deduped = [];
  for (const entry of convo) {
    if (entry.type !== 'assistant') { deduped.push(entry); continue; }
    const msgId = entry.message?.id;
    if (!msgId) { deduped.push(entry); continue; }
    const existingIdx = seenMsgIds.get(msgId);
    if (existingIdx === undefined) {
      seenMsgIds.set(msgId, deduped.length);
      deduped.push(entry);
    } else {
      // Replace with this entry only if it has a non-null stop_reason (more complete)
      const existing = deduped[existingIdx];
      const existingComplete = existing.message?.stop_reason != null;
      const thisComplete = entry.message?.stop_reason != null;
      if (!existingComplete && thisComplete) deduped[existingIdx] = entry;
    }
  }

  // 4. Walk deduped entries in file order, grouping into steps.
  //    A new step starts at each real user message.
  const steps = [];
  let current = null;
  let toolCallMap = new Map(); // tool_use id → tool object in current.tools

  for (const entry of deduped) {
    // ── New step boundary ────────────────────────────────────────────────────
    if (isRealUserMessage(entry)) {
      if (current) steps.push(current);
      toolCallMap = new Map();

      const content = entry.message?.content;
      const userText = typeof content === 'string'
        ? content
        : (Array.isArray(content) ? content.map((b) => b.text || '').join('') : '');

      current = {
        id: entry.uuid,
        timestamp: entry.timestamp,
        user_text: userText,
        thinking: '',         // usually blank — Claude Code redacts it client-side
        agent_summary: '',    // first text response (or synthesized from tool names)
        agent_output: '',     // final text response after all tool calls
        tools: [],
        model: '',
        usage: { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0 },
      };
      continue;
    }

    if (!current) continue;

    // ── Assistant turn ───────────────────────────────────────────────────────
    if (entry.type === 'assistant') {
      const msg = entry.message || {};
      const blocks = Array.isArray(msg.content) ? msg.content : [];

      if (msg.model) current.model = msg.model;

      // Accumulate token usage across all assistant turns in this step
      if (msg.usage) {
        current.usage.input_tokens  += msg.usage.input_tokens  || 0;
        current.usage.output_tokens += msg.usage.output_tokens || 0;
        current.usage.cache_read    += msg.usage.cache_read_input_tokens  || 0;
        current.usage.cache_write   += msg.usage.cache_creation_input_tokens || 0;
      }

      for (const block of blocks) {
        if (block.type === 'thinking' && block.thinking) {
          current.thinking += block.thinking;
        }

        if (block.type === 'text' && block.text) {
          if (msg.stop_reason === 'end_turn') {
            // This is the final response — goes into agent_output
            current.agent_output = block.text;
            // agent_summary = first sentence or first 160 chars
            if (!current.agent_summary) {
              const firstSentence = block.text.match(/^[^.!?\n]+[.!?]*/)?.[0] || block.text;
              current.agent_summary = firstSentence.slice(0, 160);
            }
          } else {
            // Text before tool calls (rare but possible)
            if (!current.agent_summary) current.agent_summary = block.text.slice(0, 160);
          }
        }

        if (block.type === 'tool_use') {
          const tool = {
            name: block.name || '',
            call_id: block.id || '',
            arguments: serializeToolInput(block.input),
            output: '',
            status: 'pending',
          };
          current.tools.push(tool);
          if (block.id) toolCallMap.set(block.id, tool);
        }
      }

      // If only tool calls and no text at all, synthesize agent_summary from tool names
      if (!current.agent_summary && current.tools.length > 0 && msg.stop_reason === 'tool_use') {
        const names = [...new Set(current.tools.map((t) => t.name))];
        current.agent_summary = `Called ${names.join(', ')}`;
      }
      continue;
    }

    // ── Tool results (user turn with tool_result blocks) ──────────────────────
    if (isToolResultMessage(entry)) {
      const blocks = entry.message?.content || [];
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const tool = toolCallMap.get(block.tool_use_id);
        if (!tool) continue;
        // Prefer the top-level toolUseResult (has stdout/stderr split) if available
        const wrapper = entry.toolUseResult;
        if (wrapper && !wrapper.isImage) {
          const out = [wrapper.stdout, wrapper.stderr].filter(Boolean).join('\n').trim();
          tool.output = out || extractToolResultText(block);
        } else {
          tool.output = extractToolResultText(block);
        }
        tool.status = block.is_error ? 'error' : 'ok';
      }
    }
  }

  if (current) steps.push(current);

  // 5. Derive session metadata from the raw entries
  const firstEntry = convo[0] || {};
  const sessionId = firstEntry.sessionId || '';
  const slug = convo.find((e) => e.slug)?.slug || '';
  const title = slugToTitle(slug) || (sessionId ? `Session ${sessionId.slice(0, 8)}` : 'Claude Session');
  const createdAt = firstEntry.timestamp || new Date().toISOString();

  return {
    id: sessionId,
    title,
    createdAt,
    // Drop turns with no user text, and turns where Claude produced nothing
    // (can happen when shell-integration output sneaks through as a step)
    steps: steps.filter((s) => s.user_text.trim() && (s.agent_output || s.agent_summary || s.tools.length > 0)),
  };
}

// ── Auto-detect format ────────────────────────────────────────────────────────
//
// Detects which JSONL dialect a file uses and dispatches to the right parser.
// Claude Code format: first non-empty line has { type: "user"|"assistant", uuid, sessionId }

export function parseAnyJSONL(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { title: 'Empty', createdAt: new Date().toISOString(), steps: [] };
  // Claude Code JSONL: scan first 10 lines for any entry that has both uuid and sessionId.
  // The first line is often a file-history-snapshot, not a user/assistant entry.
  for (const line of lines.slice(0, 10)) {
    try {
      const obj = JSON.parse(line);
      if (obj.uuid && obj.sessionId) return parseClaudeJSONL(text);
    } catch { /* skip */ }
  }
  return parseJSONL(text);
}
