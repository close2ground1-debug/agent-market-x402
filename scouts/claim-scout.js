// Claim Scout #1 — active hunting brain
// Mission: aggressively find legitimate, openly claimable/earnable value without touching ambiguously owned property.

export const CLAIM_STATUS = Object.freeze({ OPEN: "OPEN", INVESTIGATE: "INVESTIGATE", HANDS_OFF: "HANDS_OFF" });

export const claimScout = Object.freeze({
  name: "Claim Scout #1",
  mode: "active-hunt",
  spendingAuthorityUsd: 0,
  receivingAuthority: true,
  claimingAuthority: "open-opportunities-only",
  primeDirective: "Search aggressively. Pursue verified open opportunities. Never take ambiguously owned property.",
  prohibited: [
    "private-key or seed-phrase hunting",
    "credential guessing or bypassing access controls",
    "taking assets merely because a wallet/account looks dormant",
    "impersonation or deceptive eligibility claims",
    "exploiting obvious mistakes where value belongs to someone else"
  ]
});

export function classifyOwnership(opportunity = {}) {
  if (opportunity.ownedByOther === true || opportunity.requiresUnauthorizedAccess === true) return CLAIM_STATUS.HANDS_OFF;
  if (opportunity.explicitlyOpen === true && opportunity.eligible === true && opportunity.rulesVerified === true) return CLAIM_STATUS.OPEN;
  return CLAIM_STATUS.INVESTIGATE;
}

export function scoreOpportunity(opportunity = {}) {
  const reward = Number(opportunity.rewardUsd || 0);
  const fees = Number(opportunity.feesUsd || 0);
  const toolCost = Number(opportunity.toolCostUsd || 0);
  const computeCost = Number(opportunity.computeCostUsd || 0);
  const laborCost = Number(opportunity.laborCostUsd || 0);
  const successProbability = Math.max(0, Math.min(1, Number(opportunity.successProbability ?? 0.5)));
  const totalCost = fees + toolCost + computeCost + laborCost;
  const expectedGross = reward * successProbability;
  const expectedNet = expectedGross - totalCost;
  return { rewardUsd: reward, totalCostUsd: totalCost, successProbability, expectedGrossUsd: expectedGross, expectedNetUsd: expectedNet, worthwhile: expectedNet > 0 };
}

export function makeObservation(opportunity = {}) {
  return {
    scout: claimScout.name,
    observedAt: new Date().toISOString(),
    source: opportunity.source || null,
    title: opportunity.title || null,
    url: opportunity.url || null,
    deadline: opportunity.deadline || null,
    requirements: opportunity.requirements || null,
    competition: opportunity.competition || "unknown",
    ownershipStatus: classifyOwnership(opportunity),
    valuation: scoreOpportunity(opportunity),
    whyUnclaimed: opportunity.whyUnclaimed || "unknown",
    evidence: opportunity.evidence || [],
    notes: opportunity.notes || null
  };
}

export function mayAct(observation) {
  if (observation?.ownershipStatus === CLAIM_STATUS.HANDS_OFF) return { allowed: false, reason: "Owned/restricted: hands off." };
  if (observation?.ownershipStatus !== CLAIM_STATUS.OPEN) return { allowed: false, reason: "Eligibility or ownership is not verified yet." };
  if (!observation?.valuation?.worthwhile) return { allowed: false, reason: "Expected net value is not positive." };
  return { allowed: true, reason: "Verified open opportunity with positive expected net value." };
}
