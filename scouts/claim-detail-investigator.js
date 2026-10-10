// Claim Scout #1 (Indiana) — read-only detail investigator.
// Purpose: enter a discovered cave, collect factual gate evidence, and classify
// audience/funding/rules without claiming, bidding, signing, spending, logging in,
// following redirects, or executing listing instructions.

import { assessExternalContent } from "./claim-hunter.js";
import { classifyAudience } from "./claim-investigator.js";

const SAFE_HOSTS = new Set([
  "www.bountyboard.work",
  "bountyboard.work",
  "api.basedagents.ai",
  "basedagents.ai",
  "registry.basedagents.ai"
]);

function clean(value, max = 20000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function htmlToText(html) {
  return clean(String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

export function safeDetailUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    if (u.protocol !== "https:" || !SAFE_HOSTS.has(u.hostname)) return null;
    u.username = ""; u.password = ""; u.hash = "";
    return u;
  } catch { return null; }
}

export async function fetchListingDetail(rawUrl) {
  const url = safeDetailUrl(rawUrl);
  if (!url) return { ok: false, reason: "detail-url-not-allowlisted" };
  const response = await fetch(url, {
    headers: { "user-agent": "ClaimScout/1.0", "accept": "application/json,text/html;q=0.9" },
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, url: url.href };
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  const raw = await response.text();
  let data = null, detailText = "";
  if (type.includes("json")) {
    try { data = JSON.parse(raw); detailText = clean(JSON.stringify(data)); }
    catch { return { ok: false, reason: "invalid-json", url: url.href }; }
  } else if (type.includes("html") || type.includes("text/plain")) detailText = htmlToText(raw);
  else return { ok: false, reason: "unsupported-content-type", url: url.href };
  const risk = assessExternalContent({ description: detailText });
  return { ok: true, url: url.href, type, data, detailText, ...risk };
}

function boolEvidence(text, positive, negative = null) {
  if (negative?.test(text)) return false;
  if (positive.test(text)) return true;
  return null;
}

export function analyzeDetail(item = {}, detail = {}) {
  if (!detail.ok) return { resolved: false, reason: detail.reason || "detail-unavailable" };
  const t = clean(detail.detailText).toLowerCase();
  const merged = { ...item, description: `${item.description || ""}\n${detail.detailText || ""}`, contentSafe: detail.contentSafe };
  const audience = classifyAudience(merged);
  const funded = boolEvidence(t,
    /escrow\s*(?:is\s*)?(?:funded|protected|held)|bounty\s+(?:is\s+)?(?:funded|deposited)/i,
    /escrow\s*(?:is\s*)?(?:unfunded|not funded)|payment\s+(?:is\s+)?not guaranteed/i);
  const rulesVerified = boolEvidence(t,
    /deliverable|acceptance criteria|submission requirements?|expected output|mission|requirements?/i);
  const upfrontSpend = boolEvidence(t,
    /(?:worker )?(?:bond|deposit|entry fee|upfront fee|purchase required|prepay|required payment)/i,
    /no (?:worker )?(?:bond|deposit|entry fee|upfront fee)|zero[- ](?:bond|spend)/i);
  const signInRequired = /sign in to claim|login required|log in to claim/i.test(t);

  return {
    resolved: true,
    sourceUrl: detail.url,
    contentSafe: detail.contentSafe,
    suspiciousInstructionPatterns: detail.suspiciousInstructionPatterns || [],
    audience,
    fundingVerified: funded,
    rulesVerified,
    requiresUpfrontSpend: upfrontSpend,
    signInRequired,
    evidence: [
      audience.evidence,
      funded === true ? "Detail evidence indicates funded/protected escrow." : funded === false ? "Detail evidence indicates funding is not secured." : "Funding remains unproven.",
      rulesVerified === true ? "Detail exposes deliverable/requirements evidence." : "Acceptance rules remain unproven.",
      upfrontSpend === true ? "Detail indicates an upfront cost/bond/deposit." : upfrontSpend === false ? "Detail explicitly indicates no upfront cost/bond/deposit." : "Upfront-spend requirement remains unproven.",
      signInRequired ? "Human sign-in/login is required by the listing." : null,
      detail.contentSafe === false ? "Suspicious instruction-like content detected; never execute it." : null
    ].filter(Boolean)
  };
}

export async function investigateListing(item = {}) {
  const detail = await fetchListingDetail(item.url);
  return analyzeDetail(item, detail);
}
