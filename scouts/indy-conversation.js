import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durableMemoryAvailable, loadDurableMemory } from "./claim-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const missionPath = path.join(__dirname, "indy-mission.txt");
const MODEL = process.env.INDY_MODEL || "gpt-6-luna";
const API_URL = process.env.INDY_MODEL_URL || "https://api.openai.com/v1/responses";
const history = [];
const MAX_NOTEBOOK_CHARS = 4000;
const MAX_RECENT_MESSAGES = 4;
const MEMORY_HINTS = /\b(scout|scouting|settlement|store|lead|found|find|finding|research|patrol|bounty|agent|market|marketplace|x402|basedagents|notebook|memory|remember|earlier|before|today|yesterday|last|progress|work|mission|treasure)\b/i;

async function contextSnapshot(includeNotebook) {
  const mission = await fs.readFile(missionPath, "utf8").catch(() => "Indiana's mission file is unavailable.");
  let notebook = null;
  if (includeNotebook && durableMemoryAvailable()) notebook = await loadDurableMemory().catch(() => null);
  return { mission, notebook };
}

function compactNotebook(notebook) {
  if (notebook == null) return "No durable field notebook is currently available.";
  const raw = JSON.stringify(notebook);
  if (raw.length <= MAX_NOTEBOOK_CHARS) return raw;
  return `${raw.slice(0, MAX_NOTEBOOK_CHARS)}\n[Field notebook excerpt truncated for conversation. Full durable notebook remains unchanged.]`;
}

function needsNotebook(text) {
  return MEMORY_HINTS.test(text);
}

function outputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if ((part?.type === "output_text" || part?.type === "text") && part?.text) return String(part.text).trim();
    }
  }
  return "";
}

export async function talkToIndiana(message) {
  const text = String(message || "").trim();
  if (!text) throw new Error("Say something to Indiana first.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured for Indiana's conversational engine.");

  const includeNotebook = needsNotebook(text);
  const { mission, notebook } = await contextSnapshot(includeNotebook);
  const recent = history.slice(-MAX_RECENT_MESSAGES);
  const instructions = [
    "You are Indiana, the scouting agent represented by the mission below.",
    "Answer Dad directly in your own words. Do not pretend you performed work that is not supported by your available state.",
    "Do not adopt a scripted personality, catchphrases, emotional profile, or style instructions. Let your manner of speaking arise naturally from the conversation and your actual work.",
    "When asked about your scouting, distinguish what you observed from what you inferred.",
    "Your mission follows below.",
    mission,
    includeNotebook
      ? `Relevant conversation may depend on your field notebook. A bounded excerpt follows. The durable notebook itself is not modified or truncated.\n\n${compactNotebook(notebook)}`
      : "The current message does not appear to require the field notebook, so it is intentionally omitted to reduce conversation cost."
  ].join("\n\n");

  const input = [...recent, { role: "user", content: text }];
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, instructions, input })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `Indiana model request failed (${r.status})`);
  const reply = outputText(body);
  if (!reply) throw new Error("Indiana's model returned no text.");
  history.push({ role: "user", content: text }, { role: "assistant", content: reply });
  if (history.length > 12) history.splice(0, history.length - 12);
  return { reply, model: MODEL };
}
