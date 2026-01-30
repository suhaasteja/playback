import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const JSON_LIMIT = process.env.JSON_LIMIT || "25mb";
const TTL_SECONDS = Number.parseInt(process.env.TTL_SECONDS || "3600", 10);
const MAX_SESSIONS = Number.parseInt(process.env.MAX_SESSIONS || "200", 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const store = new Map();

app.use(express.json({ limit: JSON_LIMIT }));

function nowMs() {
  return Date.now();
}

function pruneExpired() {
  const now = nowMs();
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(id);
    }
  }
}

function enforceMaxSessions() {
  if (store.size <= MAX_SESSIONS) return;
  const overflow = store.size - MAX_SESSIONS;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

setInterval(pruneExpired, 30 * 1000).unref();

function extractOutputText(response) {
  if (!response) return "";
  if (typeof response.output_text === "string") return response.output_text;
  const output = response.output || [];
  const chunks = [];
  for (const item of output) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("").trim();
}

function buildTranscript(session, maxChars = 12000) {
  const lines = [];
  for (const step of session.steps || []) {
    const tools = (step.tools || []).map((t) => t.name).filter(Boolean).join(", ");
    if (step.user_text) lines.push(`User: ${step.user_text}`);
    if (step.agent_summary) lines.push(`Agent: ${step.agent_summary}`);
    if (step.reasoning_summary) lines.push(`Reasoning: ${step.reasoning_summary}`);
    if (tools) lines.push(`Tools: ${tools}`);
    if (step.agent_output) lines.push(`Output: ${step.agent_output}`);
    lines.push("---");
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

function buildStepTranscript(step, maxChars = 4000) {
  const lines = [];
  if (step?.user_text) lines.push(`User: ${step.user_text}`);
  if (step?.agent_summary) lines.push(`Agent: ${step.agent_summary}`);
  if (step?.reasoning_summary) lines.push(`Reasoning: ${step.reasoning_summary}`);
  const tools = (step?.tools || []).map((t) => t.name).filter(Boolean).join(", ");
  if (tools) lines.push(`Tools: ${tools}`);
  if (step?.agent_output) lines.push(`Output: ${step.agent_output}`);
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

async function summarizeSession(session) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const transcript = buildTranscript(session);
  const prompt = [
    "You summarize coding agent sessions for a playback UI.",
    "Return concise markdown with:",
    "1) A 1-2 sentence summary.",
    "2) 3-6 bullet key actions.",
    "3) Tools used (comma-separated).",
    "",
    "Session transcript:",
    transcript,
  ].join("\n");

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
    temperature: 0.2,
  });

  return extractOutputText(response) || "Summary unavailable.";
}

async function summarizeStep(step) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const transcript = buildStepTranscript(step);
  const prompt = [
    "Summarize this single step from a coding agent session.",
    "Return 1-2 concise sentences. Avoid chain-of-thought.",
    "",
    "Step content:",
    transcript,
  ].join("\n");

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
    temperature: 0.2,
  });

  return extractOutputText(response) || "Summary unavailable.";
}

app.post("/api/sessions", async (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.steps)) {
    return res.status(400).json({ error: "Missing steps[]" });
  }

  const id = crypto.randomUUID();
  const createdAt = body.createdAt || new Date().toISOString();
  const expiresAt = nowMs() + TTL_SECONDS * 1000;

  const session = {
    id,
    title: body.title || "Playback",
    createdAt,
    steps: body.steps,
    meta: body.meta || {},
  };

  if (req.query.summarize === "1" && openai) {
    try {
      session.meta.ai_summary = await summarizeSession(session);
    } catch (err) {
      session.meta.ai_summary_error = err?.message || "Summary failed";
    }
  }

  store.set(id, { data: session, expiresAt });
  enforceMaxSessions();

  res.json({ session_id: id, expires_in: TTL_SECONDS });
});

app.get("/api/sessions/:id", (req, res) => {
  pruneExpired();
  const entry = store.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(entry.data);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    sessions: store.size,
    ttl_seconds: TTL_SECONDS,
    llm: openai ? "enabled" : "disabled",
    model: OPENAI_MODEL,
  });
});

app.post("/api/sessions/:id/summary", async (req, res) => {
  if (!openai) {
    return res.status(501).json({ error: "LLM not configured" });
  }
  pruneExpired();
  const entry = store.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const summary = await summarizeSession(entry.data);
    entry.data.meta = entry.data.meta || {};
    entry.data.meta.ai_summary = summary;
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Summary failed" });
  }
});

app.post("/api/sessions/:id/steps/:index/summary", async (req, res) => {
  if (!openai) {
    return res.status(501).json({ error: "LLM not configured" });
  }
  pruneExpired();
  const entry = store.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Not found" });
  }
  const index = Number.parseInt(req.params.index, 10);
  if (Number.isNaN(index) || index < 0 || index >= entry.data.steps.length) {
    return res.status(400).json({ error: "Invalid step index" });
  }
  try {
    const step = entry.data.steps[index];
    const summary = await summarizeStep(step);
    entry.data.steps[index].ai_summary = summary;
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Summary failed" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.log(`Playback server running on http://localhost:${port}`);
});
