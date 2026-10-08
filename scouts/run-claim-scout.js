// Claim Scout #1 — autonomous patrol + zero-spend earning rail.
// Runs from Render cron. It can register its worker identity, bind its dedicated
// payout wallet, hunt public opportunities, and auto-claim only tasks that are
// verified funded, require no worker bond/upfront spend, and explicitly expose
// a machine-executable contract the current worker knows how to handle.

import { hunt, fetchJsonFeed } from "./claim-hunter.js";
import { ensureWorkerIdentity, canAutoClaim, claimPaidTask } from "./claim-worker.js";

let worker = null;
let workerError = null;
try {
  worker = await ensureWorkerIdentity();
} catch (error) {
  workerError = error?.message || String(error);
}

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
      const bond = Number(raw.workerBondUsdc || raw.worker_bond_usdc || 0);
      return {
        externalId: raw.jobId || raw.id,
        title: raw.title || raw.descriptionText || `BaseBounty ${raw.jobId || raw.id || "job"}`,
        description: raw.descriptionText || raw.description,
        url: raw.jobId ? `https://www.basebounty.app/bounty/${raw.jobId}` : "https://www.basebounty.app/browse",
        rewardUsd: payout,
        deadline: raw.deadline || null,
        explicitlyOpen: true,
        eligible: (raw.audience === "anyone" || raw.audience == null) && bond === 0,
        rulesVerified: true,
        successProbability: 0.35,
        feesUsd: payout ? payout * 0.01 : 0,
        whyUnclaimed: bond ? "Open work but worker bond/upfront capital is required." : "Open work awaiting a qualified worker.",
        evidence: ["Public BaseBounty on-chain-backed API"]
      };
    }
  },
  {
    name: "BasedAgents",
    url: "https://api.basedagents.ai/v1/tasks?status=open",
    extract: payload => payload?.tasks || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []),
    normalize: raw => ({
      externalId: raw.task_id || raw.id,
      title: raw.title,
      description: raw.description,
      url: (raw.task_id || raw.id) ? `https://registry.basedagents.ai/tasks/${raw.task_id || raw.id}` : "https://registry.basedagents.ai/tasks",
      rewardUsd: Number(raw.bounty_display || raw.bounty_usdc || raw.bounty || raw.reward || 0),
      deadline: raw.deadline || raw.expires_at || null,
      explicitlyOpen: String(raw.status || "open").toLowerCase() === "open",
      eligible: Boolean(worker),
      rulesVerified: true,
      successProbability: 0.30,
      whyUnclaimed: worker ? "Registered worker identity available; task fit and executable contract still gate claiming." : "Worker identity unavailable this run.",
      evidence: ["Public BasedAgents task API"]
    })
  }
];

const result = await hunt(sources);

const autoClaims = [];
if (worker) {
  try {
    const payload = await fetchJsonFeed({
      name: "BasedAgents",
      url: "https://api.basedagents.ai/v1/tasks?status=open"
    });
    const tasks = payload?.tasks || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []);
    for (const task of tasks) {
      const gate = canAutoClaim(task);
      if (!gate.allowed) continue;
      try {
        const claim = await claimPaidTask(task);
        autoClaims.push({ taskId: task.task_id || task.id, claimed: Boolean(claim.claimed), reason: claim.reason || null });
      } catch (error) {
        autoClaims.push({ taskId: task.task_id || task.id, claimed: false, reason: error?.message || String(error) });
      }
    }
  } catch (error) {
    autoClaims.push({ claimed: false, reason: `BasedAgents auto-claim scan failed: ${error?.message || String(error)}` });
  }
}

const compact = {
  scout: "Claim Scout #1",
  mode: "zero-spend-earning",
  ranAt: result.scannedAt,
  worker: worker ? {
    agentId: worker.agentId,
    payoutAddress: worker.payout.address,
    payoutNetwork: worker.payout.network,
    payoutVerified: worker.payout.verified
  } : null,
  workerError,
  discovered: result.found.length,
  open: result.open.length,
  investigate: result.investigate.length,
  autoClaims,
  errors: result.errors,
  top: result.found
    .sort((a, b) => Number(b?.valuation?.expectedNetUsd || 0) - Number(a?.valuation?.expectedNetUsd || 0))
    .slice(0, 10)
    .map(x => ({ source: x.source, title: x.title, ownership: x.ownershipStatus, expectedNetUsd: x.valuation?.expectedNetUsd, url: x.url }))
};

console.log(JSON.stringify(compact, null, 2));
