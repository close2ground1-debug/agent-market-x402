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

  const open = opportunity.explicitlyOpen === true;
  const eligible = opportunity.eligible === true;
  const rules = opportunity.rulesVerified === true;
  const funded = opportunity.fundingVerified === true || Number(opportunity.rewardUsd || 0) === 0;
  const noUpfrontSpend = opportunity.requiresUpfrontSpend !== true;
  const issuerOkay = opportunity.issuerVerified !== false;
  const contentSafe = opportunity.contentSafe !== false;

  if (open && eligible && rules && funded && noUpfrontSpend && issuerOkay && contentSafe) return CLAIM_STATUS.OPEN;
  return CLAIM_STATUS.INVESTIGATE;
}

export function scoreOpportunity(opportunity = {}) {
  const reward = Number(opportunity.rewardUsd || 0);
  const fees = Number(opportunity.feesUsd || 0);
  const toolCost = Number(opportunity.toolCostUsd || 0);
  const computeCost = Number(opportunity.computeCostUsd || 0);
  const laborCost = Number(opportunity.laborCostUsd || 0);
  const totalCost = fees + toolCost + computeCost + laborCost;

  const rawProbability = opportunity.successProbability;
  const probabilityKnown = rawProbability !== null && rawProbability !== undefined && Number.isFinite(Number(rawProbability));
  const successProbability = probabilityKnown
    ? Math.max(0, Math.min(1, Number(rawProbability)))
    : null;

  const expectedGross = probabilityKnown ? reward * successProbability : null;
  const expectedNet = probabilityKnown ? expectedGross - totalCost : null;

  return {
    rewardUsd: reward,
    totalCostUsd: totalCost,
    successProbability,
    probabilityKnown,
    expectedGrossUsd: expectedGross,
    expectedNetUsd: expectedNet,
    worthwhile: probabilityKnown ? expectedNet > 0 : false,
    valuationComplete: probabilityKnown
  };
}

export function makeObservation(opportunity = {}) {
  const missingChecks = [];
  if (opportunity.explicitlyOpen !== true) missingChecks.push("open-status");
  if (opportunity.eligible !== true) missingChecks.push("eligibility");
  if (opportunity.rulesVerified !== true) missingChecks.push("rules");
  if (opportunity.fundingVerified !== true && Number(opportunity.rewardUsd || 0) > 0) missingChecks.push("funding");
  if (opportunity.requiresUpfrontSpend === true) missingChecks.push("upfront-spend");
  if (opportunity.issuerVerified === false) missingChecks.push("issuer");
  if (opportunity.contentSafe === false) missingChecks.push("suspicious-content");

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
    verification: {
      rulesVerified: opportunity.rulesVerified === true,
      fundingVerified: opportunity.fundingVerified === true,
      issuerVerified: opportunity.issuerVerified !== false,
      eligible: opportunity.eligible === true,
      requiresUpfrontSpend: opportunity.requiresUpfrontSpend === true,
      contentSafe: opportunity.contentSafe !== false,
      missingChecks
    },
    notes: opportunity.notes || null
  };
}

export function mayAct(observation) {
  if (observation?.ownershipStatus === CLAIM_STATUS.HANDS_OFF) return { allowed: false, reason: "Owned/restricted: hands off." };
  if (observation?.ownershipStatus !== CLAIM_STATUS.OPEN) return { allowed: false, reason: "Eligibility, ownership, funding, rules, issuer trust, or content safety is not fully verified yet." };
  if (!observation?.valuation?.valuationComplete) return { allowed: false, reason: "Expected value cannot be estimated from evidence yet." };
  if (!observation?.valuation?.worthwhile) return { allowed: false, reason: "Expected net value is not positive." };
  return { allowed: true, reason: "Verified open, funded, zero-upfront-spend opportunity with safe content and positive evidence-based expected net value." };
}
