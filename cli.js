import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

function usage() {
  console.log("Usage: node cli.js <session.jsonl|session.json> [--server URL] [--open] [--summarize]");
}

function unique(arr) {
  return [...new Set(arr)];
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

function parseReasoningSummary(payload) {
  if (!payload || !payload.summary) return "";
  if (Array.isArray(payload.summary)) {
    for (const entry of payload.summary) {
      if (entry && typeof entry.summary_text === "string") return entry.summary_text;
      if (entry && typeof entry.text === "string") return entry.text;
    }
  }
  if (typeof payload.summary === "string") return payload.summary;
  return "";
}

function generateReasoning(step) {
  const toolNames = unique(step.tools.map((t) => t.name)).filter(Boolean);
  const parts = [];
  if (toolNames.length) {
    parts.push(`Used tools: ${toolNames.join(", ")}`);
  }
  if (step.agent_summary) {
    parts.push(step.agent_summary.replace(/\.$/, ""));
  }
  if (!parts.length && step.user_text) {
    const trimmed = step.user_text.length > 80 ? step.user_text.slice(0, 77) + "..." : step.user_text;
    parts.push(`Responded to: \"${trimmed}\"`);
  }
  return parts.length ? parts.join(". ") + "." : "";
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
        if (!current.reasoning_summary) {
          current.reasoning_summary = parseReasoningSummary(payload);
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

  for (const step of steps) {
    if (!step.reasoning_summary) {
      step.reasoning_summary = generateReasoning(step);
    }
  }

  return {
    title: "Playback",
    createdAt: new Date().toISOString(),
    steps,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    usage();
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  const serverArg = args.findIndex((a) => a === "--server");
  const server = serverArg >= 0 ? args[serverArg + 1] : "http://localhost:3000";
  const shouldOpen = args.includes("--open");
  const shouldSummarize = args.includes("--summarize");

  const raw = fs.readFileSync(filePath, "utf8");
  let session;

  if (filePath.endsWith(".json")) {
    session = JSON.parse(raw);
  } else {
    session = parseJSONL(raw);
  }

  const url = new URL(`${server}/api/sessions`);
  if (shouldSummarize) {
    url.searchParams.set("summarize", "1");
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Upload failed:", err);
    process.exit(1);
  }

  const data = await res.json();
  const sessionUrl = `${server}/session/${data.session_id}`;
  console.log(sessionUrl);

  if (shouldOpen) {
    try {
      execFileSync("open", [sessionUrl], { stdio: "ignore" });
    } catch {
      // Ignore errors; user can open manually
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
