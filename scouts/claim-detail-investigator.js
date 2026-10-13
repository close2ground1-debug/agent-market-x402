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
  let url = safeDetailUrl(rawUrl);
  // Registry HTML includes site-wide payment copy, not task-specific evidence.
  if (url?.hostname === "registry.basedagents.ai" && /^\/tasks\/task_[A-Za-z0-9]+$/.test(url.pathname)) url = new URL(`https://api.basedagents.ai/v1${url.pathname}`);
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

export function basedAgentRewardUsd(task = {}) {
  const amount = task.bounty?.amount_display;
  if (task.bounty === null && /free,? with no bounty|no bounty/i.test(task.description || "")) return 0;
  return task.bounty?.token === "USDC" && amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null;
}

export function analyzeDetail(item = {}, detail = {}) {
  if (!detail.ok) return { resolved: false, reason: detail.reason || "detail-unavailable" };
  const task = detail.data?.task;
  if (task && item.source === "BasedAgents") {
    const text = clean(`${task.title||""} ${task.description||""} ${task.expected_output||""}`);
    const audience = classifyAudience({description:text});
    if (audience.audience === "UNKNOWN" && task.claimable === true && task.status === "open") Object.assign(audience,{audience:"AGENT",agentEligible:true,evidence:"Task API explicitly exposes an open, agent-claimable task; capability fit still requires review."});
    const amount = task.bounty?.amount_display;
    const noBounty = task.bounty === null && /(?:free,? with no bounty|no bounty)/i.test(text);
    const rewardUsd = basedAgentRewardUsd(task);
    const costRequired = /(?:worker|claimant|participant|you)\s+(?:must|need to|are required to)\s+(?:pay|deposit|purchase)|(?:requires?|required)\s+(?:a\s+)?(?:worker bond|entry fee|upfront payment)|paid external|paid deployment/i.test(text);
    const zeroCost = /free,? with no bounty|no (?:worker bond|entry fee|upfront (?:fee|payment))|zero[- ]spend/i.test(text);
    return {resolved:true,sourceUrl:detail.url,contentSafe:detail.contentSafe,audience,rewardUsd,
      fundingVerified:task.escrow?.status === "funded" ? true : noBounty ? true : null,
      rulesVerified:Boolean(task.expected_output && task.description),
      requiresUpfrontSpend:costRequired ? true : zeroCost ? false : null,
      evidence:[audience.evidence,`Task-specific API reward: ${rewardUsd == null ? "unverified" : rewardUsd+" USDC"}.`,costRequired?"Task-specific requirements indicate worker spending.":zeroCost?"Task explicitly states zero upfront cost.":"Worker spending remains unverified."]};
  }
  const t = clean(detail.detailText).toLowerCase();
  const merged = { ...item, description: `${item.description || ""}\n${detail.detailText || ""}`, contentSafe: detail.contentSafe };
  const audience = classifyAudience(merged);
  const funded = boolEvidence(t,
    /escrow\s*(?:is\s*)?(?:funded|protected|held)|bounty\s+(?:is\s+)?(?:funded|deposited)/i,
    /escrow\s*(?:is\s*)?(?:unfunded|not funded)|payment\s+(?:is\s+)?not guaranteed/i);
  const rulesVerified = boolEvidence(t,
    /deliverable|acceptance criteria|submission requirements?|expected output|mission|requirements?/i);
  const upfrontSpend = boolEvidence(t,
    /(?:worker bond|worker deposit|entry fee|upfront fee|purchase required|prepay|required payment)|(?:you|worker|participant) must (?:pay|deposit|purchase)/i,
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
