// Claim Scout #1 — public opportunity hunter.
// Searches configured public feeds only. It does not probe wallets, credentials, or private systems.

import { makeObservation, CLAIM_STATUS } from "./claim-scout.js";
import { rememberOpportunity } from "./claim-ledger.js";

const DEFAULT_TERMS = [
  "bounty", "reward", "grant", "prize", "hackathon", "incentive",
  "developer credit", "builder program", "first come", "open call"
];

export function looksLikeTreasure(text = "") {
  const haystack = String(text).toLowerCase();
  return DEFAULT_TERMS.some(term => haystack.includes(term));
}

export async function fetchJsonFeed(source) {
  if (!source?.url) throw new Error("source.url is required");
  const response = await fetch(source.url, {
    headers: { "user-agent": "ClaimScout/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${source.name || source.url}: HTTP ${response.status}`);
  return response.json();
}

export function ingestCandidate(candidate = {}) {
  const observation = makeObservation(candidate);
  return rememberOpportunity({ ...candidate, ...observation });
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
        const text = `${candidate.title || ""} ${candidate.description || ""}`;
        if (!looksLikeTreasure(text) && candidate.explicitlyOpen !== true) continue;
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
    errors
  };
}
