// Claim Scout #1 (Indiana) — investigation depth gate.
// Turns repeated sightings into explicit questions instead of endlessly
// rediscovering the same listing. This module NEVER claims, bids, signs,
// spends, or upgrades an opportunity by assumption.

const REQUIRED = ["eligibility", "rules", "funding"];

function ageHours(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 36e5) : null;
}

function blob(item = {}) {
  return [item.title, item.description, item.requirements, ...(item.evidence || [])]
    .filter(Boolean).join("\n").toLowerCase();
}

// This is an evidence classifier, not an eligibility assumption. It only makes a
// positive/negative audience decision when the listing itself says so.
export function classifyAudience(item = {}) {
  const t = blob(item);
  const agentDenied = /agents?\s*(?:are\s*)?(?:not allowed|prohibited|ineligible|not eligible|forbidden)/i.test(t) ||
    /human(?:s| workers?)?\s+only/i.test(t);
  const agentExplicit = /agents?\s*(?:are\s*)?(?:allowed|eligible|welcome)/i.test(t) ||
    /agent[- ](?:ready|native)/i.test(t) || item.agentAllowed === true;
  const humanExplicit = /human(?:s| workers?)?\s*(?:are\s*)?(?:allowed|eligible|welcome)/i.test(t) ||
    /human(?:s| workers?)?\s+only/i.test(t) || item.humanAllowed === true;

  if (agentDenied) return { audience: "HUMAN", agentEligible: false, humanPotentiallyEligible: true, evidence: "Listing explicitly excludes agents." };
  if (agentExplicit && humanExplicit) return { audience: "EITHER", agentEligible: true, humanPotentiallyEligible: true, evidence: "Listing explicitly permits agents and humans." };
  if (agentExplicit) return { audience: "AGENT", agentEligible: true, humanPotentiallyEligible: null, evidence: "Listing explicitly permits agents." };
  if (humanExplicit) return { audience: "HUMAN", agentEligible: null, humanPotentiallyEligible: true, evidence: "Listing explicitly permits humans." };
  return { audience: "UNKNOWN", agentEligible: null, humanPotentiallyEligible: null, evidence: "Audience not proven by available listing evidence." };
}

export function investigationPlan(item = {}) {
  const missing = new Set(item?.verification?.missingChecks || []);
  const questions = [];
  const audience = classifyAudience(item);

  if (audience.audience === "UNKNOWN") questions.push("Is this opportunity for an AI agent, a human, or either?");
  if (missing.has("eligibility")) questions.push("Are we, specifically, allowed to claim or bid on this opportunity right now?");
  if (missing.has("rules")) questions.push("What exact deliverable and acceptance criteria release the reward?");
  if (missing.has("funding")) questions.push("Is this specific reward funded or otherwise payment-guaranteed, not merely advertised?");
  if (missing.has("usd-valuation")) questions.push("What is the reward worth in USD using a timestamped trustworthy FX quote?");
  if (item?.verification?.requiresUpfrontSpend == null) questions.push("Does participation require a bond, fee, purchase, deposit, or other upfront spend?");
  if (item?.verification?.issuerVerified == null) questions.push("Can the issuer/platform identity and payout process be independently verified?");
  questions.push("WHY HASN'T SOMEBODY CLAIMED THIS ALREADY?");

  return {
    opportunityId: item.id || null,
    source: item.source || null,
    title: item.title || null,
    seenCount: Number(item.seenCount || 0),
    ageHours: ageHours(item.firstSeenAt),
    ownership: item.ownershipStatus || null,
    audience,
    missingChecks: [...missing],
    questions,
    proofStandard: "OPEN only after affirmative evidence answers every required gate; human-only opportunities are surfaced for Dad, not discarded or agent-claimed.",
    mayClaim: false
  };
}

export function chooseProofCandidate(items = []) {
  const candidates = items
    .filter(x => x?.ownershipStatus === "INVESTIGATE")
    .map(x => ({ item: x, plan: investigationPlan(x) }))
    .filter(({ plan }) => REQUIRED.some(k => plan.missingChecks.includes(k)))
    .sort((a, b) => {
      const rewardA = Number(a.item?.valuation?.rewardUsd || 0);
      const rewardB = Number(b.item?.valuation?.rewardUsd || 0);
      if (rewardB !== rewardA) return rewardB - rewardA;
      return Number(b.item?.seenCount || 0) - Number(a.item?.seenCount || 0);
    });
  return candidates[0]?.plan || null;
}

export function investigationMetrics(items = []) {
  const investigate = items.filter(x => x?.ownershipStatus === "INVESTIGATE");
  const stale = investigate.filter(x => Number(x?.seenCount || 0) >= 3);
  const humanOpportunities = investigate.filter(x => classifyAudience(x).audience === "HUMAN");
  return {
    investigateCount: investigate.length,
    repeatedUnresolvedCount: stale.length,
    humanOpportunityCount: humanOpportunities.length,
    investigationBottleneck: stale.length > 0,
    rule: "Three or more sightings without a gate decision is an investigation-depth failure, not a hunting success."
  };
}
