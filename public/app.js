const state = {
  session: null,
  steps: [],
  currentIndex: 0,
  timer: null,
  speed: 1,
};

const laneRows = document.getElementById("laneRows");
const detailBody = document.getElementById("detailBody");
const sessionMeta = document.getElementById("sessionMeta");
const tapeDeck = document.getElementById("tapeDeck");
const labelTitle = document.getElementById("labelTitle");
const statusText = document.getElementById("statusText");
const timeCode = document.getElementById("timeCode");
const recordBtn = document.getElementById("recordBtn");
const eqBars = document.getElementById("eqBars");
const bars = eqBars ? Array.from(eqBars.querySelectorAll(".bar")) : [];

const btnPlay = document.getElementById("btnPlay");
const btnPause = document.getElementById("btnPause");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const speedSelect = document.getElementById("speed");
const fileInput = document.getElementById("fileInput");
const toggleMinimal = document.getElementById("toggleMinimal");
const deckPlay = document.getElementById("deckPlay");
const deckPause = document.getElementById("deckPause");
const deckPrev = document.getElementById("deckPrev");
const deckNext = document.getElementById("deckNext");
const scrubber = document.getElementById("scrubber");
const stepCounter = document.getElementById("stepCounter");
const speedLabel = document.getElementById("speedLabel");
let visualizerTimer = null;

function truncate(text, len = 120) {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function extractContentText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          if (typeof item.text === "string") return item.text;
          if (typeof item.output_text === "string") return item.output_text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function parseJSONL(text) {
  const steps = [];
  let current = null;
  let stepIndex = 0;
  const callIndex = new Map();
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const topType = obj.type;
    const payload = obj.payload || {};

    if (topType === "event_msg" && payload.type === "user_message") {
      if (current) steps.push(current);
      stepIndex += 1;
      current = {
        id: `t${stepIndex}`,
        timestamp: obj.timestamp || payload.timestamp || "",
        user_text: payload.message || payload.text || "",
        agent_summary: "",
        reasoning_summary: "",
        agent_output: "",
        tools: [],
      };
      continue;
    }

    if (!current) continue;

    if (topType === "event_msg" && payload.type === "agent_message") {
      if (!current.agent_summary && payload.message) {
        current.agent_summary = payload.message;
      }
      continue;
    }

    if (topType === "response_item") {
      const ptype = payload.type;
      if (ptype === "message") {
        current.agent_output += extractContentText(payload.content || payload.text || "");
      } else if (ptype === "reasoning") {
        if (!current.reasoning_summary && payload.summary && Array.isArray(payload.summary)) {
          const entry = payload.summary.find((s) => s && (s.summary_text || s.text));
          current.reasoning_summary = (entry && (entry.summary_text || entry.text)) || "";
        }
      } else if (ptype === "function_call") {
        const tool = {
          name: payload.name || "",
          arguments: payload.arguments || "",
          call_id: payload.call_id || "",
          output: "",
          status: "pending",
        };
        current.tools.push(tool);
        if (tool.call_id) callIndex.set(tool.call_id, current.tools.length - 1);
      } else if (ptype === "function_call_output") {
        const callId = payload.call_id || "";
        const idx = callIndex.get(callId);
        if (idx !== undefined && current.tools[idx]) {
          current.tools[idx].output = payload.output || "";
          current.tools[idx].status = "ok";
        }
      }
    }
  }

  if (current) steps.push(current);

  return {
    title: "Playback",
    createdAt: new Date().toISOString(),
    steps,
  };
}

function renderRows() {
  laneRows.innerHTML = "";
  state.steps.forEach((step, index) => {
    const row = document.createElement("div");
    row.className = "lane-row" + (index === state.currentIndex ? " active" : "");
    row.dataset.index = String(index);
    row.style.setProperty("--i", index);

    const tools = step.tools && step.tools.length
      ? step.tools.map((t) => t.name).filter(Boolean).join(", ")
      : "";

    row.innerHTML = `
      <div class="cell user">${truncate(step.user_text || "(no user text)")}</div>
      <div class="cell agent">${truncate(step.agent_summary || step.reasoning_summary || "")}</div>
      <div class="cell muted tools">${truncate(tools || "(no tools)")}</div>
      <div class="cell output">${truncate(step.agent_output || "")}</div>
    `;

    row.addEventListener("click", () => {
      setActiveStep(index);
      pause();
    });

    laneRows.appendChild(row);
  });
}

function renderDetail() {
  const step = state.steps[state.currentIndex];
  if (!step) {
    detailBody.textContent = "No step selected.";
    return;
  }

  const tools = (step.tools || []).map((t) => {
    const args = t.arguments ? `Args: ${t.arguments}` : "";
    const out = t.output ? `Output: ${t.output}` : "";
    return `- ${t.name || "(tool)"} [${t.status || "pending"}]\n  ${args}\n  ${out}`.trim();
  });

  const detail = [
    `Step: ${step.id || state.currentIndex + 1}`,
    step.timestamp ? `Time: ${step.timestamp}` : "",
    "",
    `User: ${step.user_text || ""}`,
    "",
    `Agent summary: ${step.agent_summary || ""}`,
    step.reasoning_summary ? `Reasoning: ${step.reasoning_summary}` : "",
    "",
    `Tools:\n${tools.length ? tools.join("\n") : "(none)"}`,
    "",
    `Output: ${step.agent_output || ""}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  detailBody.textContent = detail;
}

function updateMeta() {
  if (!state.session) return;
  const title = state.session.title || "Playback";
  const createdAt = state.session.createdAt || "";
  sessionMeta.textContent = createdAt ? `${title} • ${createdAt}` : title;
  labelTitle.textContent = title;
  if (statusText && !state.timer) {
    statusText.textContent = "Ready to replay";
  }
}

function updateDeck() {
  const total = state.steps.length;
  scrubber.max = total > 0 ? String(total - 1) : "0";
  scrubber.value = String(state.currentIndex);
  stepCounter.textContent = `Step ${total ? state.currentIndex + 1 : 0} / ${total}`;
  speedLabel.textContent = `${state.speed}x`;
  const seconds = Math.floor(state.currentIndex * 1.5);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const frames = Math.floor((state.currentIndex * 12) % 100);
  const pad = (n) => String(n).padStart(2, "0");
  if (timeCode) {
    timeCode.textContent = `${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
  }
}

function setActiveStep(index) {
  if (index < 0 || index >= state.steps.length) return;
  state.currentIndex = index;
  renderRows();
  renderDetail();
  updateDeck();
  const activeRow = laneRows.querySelector(`.lane-row[data-index="${index}"]`);
  if (activeRow) {
    const container = laneRows;
    const rowTop = activeRow.offsetTop;
    const rowBottom = rowTop + activeRow.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (rowTop < viewTop + 8) {
      container.scrollTo({ top: Math.max(0, rowTop - 8), behavior: "smooth" });
    } else if (rowBottom > viewBottom - 8) {
      container.scrollTo({ top: rowBottom - container.clientHeight + 8, behavior: "smooth" });
    }
  }
}

function next() {
  if (state.currentIndex < state.steps.length - 1) {
    setActiveStep(state.currentIndex + 1);
  } else {
    pause();
  }
}

function prev() {
  setActiveStep(Math.max(0, state.currentIndex - 1));
}

function startVisualizer() {
  if (!bars.length || visualizerTimer) return;
  visualizerTimer = setInterval(() => {
    bars.forEach((bar) => {
      bar.style.height = `${Math.random() * 80 + 10}%`;
    });
  }, 90);
}

function stopVisualizer() {
  if (!visualizerTimer) return;
  clearInterval(visualizerTimer);
  visualizerTimer = null;
  bars.forEach((bar) => {
    bar.style.height = "10%";
  });
}

function play() {
  if (state.timer) return;
  const interval = 1500 / state.speed;
  state.timer = setInterval(next, interval);
  tapeDeck.classList.add("is-playing");
  tapeDeck.classList.add("is-recording");
  if (statusText) statusText.textContent = "Playing... keep it loud!";
  startVisualizer();
}

function pause() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  tapeDeck.classList.remove("is-playing");
  tapeDeck.classList.remove("is-recording");
  if (statusText) statusText.textContent = "Paused.";
  stopVisualizer();
}

function loadSession(session) {
  state.session = session;
  state.steps = Array.isArray(session.steps) ? session.steps : [];
  state.currentIndex = 0;
  updateMeta();
  renderRows();
  renderDetail();
  updateDeck();
}

async function loadFromServer(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) {
    detailBody.textContent = "Session not found.";
    return;
  }
  const session = await res.json();
  loadSession(session);
}

btnPlay.addEventListener("click", play);
btnPause.addEventListener("click", pause);
btnPrev.addEventListener("click", prev);
btnNext.addEventListener("click", next);
deckPlay.addEventListener("click", play);
deckPause.addEventListener("click", pause);
deckPrev.addEventListener("click", prev);
deckNext.addEventListener("click", next);
if (recordBtn) {
  recordBtn.addEventListener("click", () => {
    if (state.timer) {
      pause();
    } else {
      play();
    }
  });
}

speedSelect.addEventListener("change", (e) => {
  state.speed = Number.parseFloat(e.target.value || "1");
  if (state.timer) {
    pause();
    play();
  }
  updateDeck();
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let session;
  if (file.name.endsWith(".jsonl")) {
    session = parseJSONL(text);
  } else {
    session = JSON.parse(text);
  }
  loadSession(session);
});

scrubber.addEventListener("input", (e) => {
  const value = Number.parseInt(e.target.value || "0", 10);
  pause();
  setActiveStep(value);
});

if (toggleMinimal) {
  const stored = localStorage.getItem("minimalView");
  if (stored === "true") {
    document.body.classList.add("is-minimal");
  }
  toggleMinimal.addEventListener("click", () => {
    document.body.classList.toggle("is-minimal");
    localStorage.setItem("minimalView", document.body.classList.contains("is-minimal") ? "true" : "false");
  });
}

const pathParts = window.location.pathname.split("/").filter(Boolean);
if (pathParts[0] === "session" && pathParts[1]) {
  loadFromServer(pathParts[1]);
}
