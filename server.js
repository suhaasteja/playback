import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const JSON_LIMIT = process.env.JSON_LIMIT || "25mb";
const TTL_SECONDS = Number.parseInt(process.env.TTL_SECONDS || "3600", 10);
const MAX_SESSIONS = Number.parseInt(process.env.MAX_SESSIONS || "200", 10);

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

app.post("/api/sessions", (req, res) => {
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
  res.json({ ok: true, sessions: store.size, ttl_seconds: TTL_SECONDS });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.log(`Playback server running on http://localhost:${port}`);
});
