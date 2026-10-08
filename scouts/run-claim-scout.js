// Claim Scout #1 — autonomous read-only patrol runner.
// Runs from Render cron. Discovers and scores public opportunities; never signs or spends.

import { hunt } from "./claim-hunter.js";

const sources = [
  {
    name: "BountyBoard",
    url: "https://www.bountyboard.work/api/bounties?status=OPEN&limit=50",
    extract: payload => payload?.bounties || payload?.items || (Array.isArray(payload) ? payload : []),
    normalize: raw => ({
      externalId: raw.id,
      title: raw.title,
      description: raw.description,
      url: raw.url || (raw.id ? `https://www.bountyboard.work/bounties/${raw.id}` : null),
      rewardUsd: Number(raw.rewardUsd || raw.reward || raw.amount || 0),
      deadline: raw.deadline || raw.expiresAt || null,
      explicitlyOpen: String(raw.status || "OPEN").toUpperCase() === "OPEN",
      eligible: false,
      rulesVerified: true,
      successProbability: 0.25,
      feesUsd: Number(raw.rewardUsd || raw.reward || raw.amount || 0) * 0.10,
      whyUnclaimed: "Requires fit, bid/claim, delivery and approval. Eligibility must be checked per bounty.",
      evidence: ["Public BountyBoard OPEN listing"]
    })
  },
  {
    name: "BaseBounty",
    url: "https://www.basebounty.app/api/v1/bounties?status=open",
    extract: payload => payload?.bounties || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []),
    normalize: raw => {
      const payout = Number(raw.workerPayoutUsdc || raw.rewardUsdc || raw.reward || 0);
      return {
        externalId: raw.jobId || raw.id,
        title: raw.title || raw.descriptionText || `BaseBounty ${raw.jobId || raw.id || "job"}`,
        description: raw.descriptionText || raw.description,
        url: raw.jobId ? `https://www.basebounty.app/bounty/${raw.jobId}` : "https://www.basebounty.app/browse",
        rewardUsd: payout,
        deadline: raw.deadline || null,
        explicitlyOpen: true,
        eligible: raw.audience === "anyone" || raw.audience == null,
        rulesVerified: true,
        successProbability: 0.35,
        feesUsd: payout ? payout * 0.01 : 0,
        whyUnclaimed: raw.workerBondUsdc ? "Open work but worker bond may be required." : "Open work awaiting a qualified worker.",
        evidence: ["Public BaseBounty on-chain-backed API"]
      };
    }
  },
  {
    name: "BasedAgents",
    url: "https://api.basedagents.ai/v1/tasks?status=open",
    extract: payload => payload?.tasks || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []),
    normalize: raw => ({
      externalId: raw.id,
      title: raw.title,
      description: raw.description,
      url: raw.id ? `https://registry.basedagents.ai/tasks/${raw.id}` : "https://registry.basedagents.ai/tasks",
      rewardUsd: Number(raw.bounty || raw.bounty_usdc || raw.reward || 0),
      deadline: raw.deadline || raw.expires_at || null,
      explicitlyOpen: String(raw.status || "open").toLowerCase() === "open",
      eligible: false,
      rulesVerified: true,
      successProbability: 0.30,
      whyUnclaimed: "Requires registered agent identity, matching capability and payout wallet before claim.",
      evidence: ["Public BasedAgents task API"]
    })
  }
];

const result = await hunt(sources);
const compact = {
  scout: "Claim Scout #1",
  ranAt: result.scannedAt,
  discovered: result.found.length,
  open: result.open.length,
  investigate: result.investigate.length,
  errors: result.errors,
  top: result.found
    .sort((a, b) => Number(b?.valuation?.expectedNetUsd || 0) - Number(a?.valuation?.expectedNetUsd || 0))
    .slice(0, 10)
    .map(x => ({ source: x.source, title: x.title, ownership: x.ownershipStatus, expectedNetUsd: x.valuation?.expectedNetUsd, url: x.url }))
};

console.log(JSON.stringify(compact, null, 2));
