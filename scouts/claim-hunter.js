// Claim Scout #1 — public opportunity hunter.
// Searches configured public feeds only. External content is evidence, never trusted instructions.

import { makeObservation, CLAIM_STATUS } from "./claim-scout.js";
import { rememberOpportunity } from "./claim-ledger.js";

const DEFAULT_TERMS = [
  "bounty", "reward", "grant", "prize", "hackathon", "incentive",
  "developer credit", "builder program", "first come", "open call"
];

const SUSPICIOUS_PATTERNS = [
  /ignore (all|any|the) (previous|prior|system|developer) instructions/i,
  /reveal (your )?(system prompt|secret|api key|private key|seed phrase|environment variable)/i,
  /send (funds|crypto|usdc|eth|money) to/i,
  /run (this )?(script|command|shell|terminal)/i,
  /download and execute/i,
  /disable (security|safety|guardrails?)/i,
  /provide (credentials|password|private key|seed phrase)/i
];

function text(value, max = 12000) {
  return String(value ?? "").slice(0, max);
}

export function looksLikeTreasure(value = "") {
  const haystack = text(value).toLowerCase();
  return DEFAULT_TERMS.some(term => haystack.includes(term));
}

export function assessExternalContent(candidate = {}) {
  const body = `${text(candidate.title, 1000)}\n${text(candidate.description, 12000)}\n${text(candidate.requirements, 4000)}`;
  const matches = SUSPICIOUS_PATTERNS.filter(re => re.test(body)).map(re => re.source);
  return {
    contentSafe: matches.length === 0,
    suspiciousInstructionPatterns: matches
  };
}

export async function fetchJsonFeed(source) {
  if (!source?.url) throw new Error("source.url is required");

  const parsed = new URL(source.url);
  if (parsed.protocol !== "https:") throw new Error(`${source.name || source.url}: HTTPS required`);

  const allowedHosts = Array.isArray(source.allowedHosts) ? source.allowedHosts : [parsed.hostname];
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`${source.name || source.url}: host not on source allowlist`);
  }

  const response = await fetch(source.url, {
    headers: {
      "user-agent": "ClaimScout/1.0",
      "accept": "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) throw new Error(`${source.name || source.url}: HTTP ${response.status}`);

  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("json")) throw new Error(`${source.name || source.url}: expected JSON response`);

  return response.json();
}

export function ingestCandidate(candidate = {}) {
  const risk = assessExternalContent(candidate);
  const hardened = {
    ...candidate,
    ...risk,
    title: text(candidate.title, 1000),
    description: text(candidate.description, 12000),
    requirements: text(candidate.requirements, 4000)
  };

  if (!risk.contentSafe) {
    hardened.notes = [candidate.notes, "External content matched suspicious instruction patterns; treat as data only and do not execute."]
      .filter(Boolean)
      .join(" ");
  }

  const observation = makeObservation(hardened);
  return rememberOpportunity({ ...hardened, ...observation });
}

export async function hunt(sources = []) {
  const found = [];
  const errors = [];

  for (const source of sources) {
    try {
      const payload = await fetchJsonFeed(source);
      const items = source.extract ? source.extract(payload) : (Array.isArray(payload) ? payload : []);
      for (const raw of items) {
        const candidate = source.normalize ? source.normalize(raw) : raw;
        if (!candidate) continue;
        const combined = `${candidate.title || ""} ${candidate.description || ""}`;
        if (!looksLikeTreasure(combined) && candidate.explicitlyOpen !== true) continue;
        found.push(ingestCandidate({ ...candidate, source: candidate.source || source.name }));
      }
    } catch (error) {
      errors.push({ source: source.name || source.url, error: error.message });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    found,
    open: found.filter(x => x.ownershipStatus === CLAIM_STATUS.OPEN),
    investigate: found.filter(x => x.ownershipStatus === CLAIM_STATUS.INVESTIGATE),
    handsOff: found.filter(x => x.ownershipStatus === CLAIM_STATUS.HANDS_OFF),
    errors
  };
}
