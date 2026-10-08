// Claim Scout #1 — patrol + zero-spend earning rail.
// Durable memory is available in GitHub Actions through Issue #1 and the
// short-lived built-in GITHUB_TOKEN. Real external claims remain disabled
// unless CLAIM_SCOUT_AUTO_CLAIM=enabled is explicitly configured.

import { hunt, fetchJsonFeed } from "./claim-hunter.js";
import { ensureWorkerIdentity, canAutoClaim, claimPaidTask } from "./claim-worker.js";
import { hydrateLedger, exportLedger, ledgerSummary } from "./claim-ledger.js";
import { durableMemoryAvailable, loadDurableMemory, saveDurableMemory } from "./claim-memory.js";

let memoryLoad = { available: durableMemoryAvailable(), loaded: false, error: null };
if (memoryLoad.available) {
  try {
    hydrateLedger(await loadDurableMemory());
    memoryLoad.loaded = true;
  } catch (error) {
    memoryLoad.error = error?.message || String(error);
  }
}

let worker = null;
let workerError = null;
try {
  worker = await ensureWorkerIdentity();
} catch (error) {
  workerError = error?.message || String(error);
}

function escrowFunded(raw = {}) {
  return String(raw?.escrow?.status || raw.escrow_status || "").toLowerCase() === "funded";
}

function bountyBoardMoney(raw = {}) {
  // BountyBoard documents API monetary amounts in minor units (e.g. 9000 = 90.00).
  const minor = raw.reward ?? raw.amount ?? raw.rewardAmount ?? null;
  const currency = String(raw.currency || raw.currencyCode || "USD").toUpperCase();
  const nativeAmount = minor === null || minor === undefined || !Number.isFinite(Number(minor))
    ? null
    : Number(minor) / 100;
  return {
    rewardUsd: currency === "USD" ? nativeAmount : null,
    rewardNativeAmount: nativeAmount,
    rewardNativeCurrency: currency
  };
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
      ...bountyBoardMoney(raw),
      deadline: raw.deadline || raw.expiresAt || null,
      explicitlyOpen: String(raw.status || "").toUpperCase() === "OPEN",
      eligible: false,
      rulesVerified: false,
      fundingVerified: false,
      issuerVerified: null,
      requiresUpfrontSpend: null,
      successProbability: null,
      feesUsd: 0,
      whyUnclaimed: "Needs per-bounty verification of rules, eligibility, funding, fees and acceptance conditions.",
      evidence: ["Public BountyBoard listing only; listing alone does not prove eligibility or funding."]
    })
  },
  {
    name: "BaseBounty",
    url: "https://www.basebounty.app/api/v1/bounties?status=open",
    extract: payload => payload?.bounties || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []),
    normalize: raw => {
      const payout = Number(raw.workerPayoutUsdc || raw.rewardUsdc || raw.reward || 0);
      const bond = Number(raw.workerBondUsdc || raw.worker_bond_usdc || 0);
      const funded = escrowFunded(raw) || raw.funded === true;
      return {
        externalId: raw.jobId || raw.id,
        title: raw.title || raw.descriptionText || `BaseBounty ${raw.jobId || raw.id || "job"}`,
        description: raw.descriptionText || raw.description,
        url: raw.jobId ? `https://www.basebounty.app/bounty/${raw.jobId}` : "https://www.basebounty.app/browse",
        rewardUsd: payout,
        deadline: raw.deadline || null,
        explicitlyOpen: String(raw.status || "open").toLowerCase() === "open",
        eligible: (raw.audience === "anyone" || raw.audience == null) && bond === 0,
        rulesVerified: false,
        fundingVerified: funded,
        issuerVerified: null,
        requiresUpfrontSpend: bond > 0,
        successProbability: null,
        feesUsd: 0,
        whyUnclaimed: bond ? "Worker bond/upfront capital is required." : "Open listing detected; task rules and acceptance criteria still require verification.",
        evidence: funded ? ["Listing reports funded escrow."] : ["Public BaseBounty listing; funding not independently verified from this payload."]
      };
    }
  },
  {
    name: "BasedAgents",
    url: "https://api.basedagents.ai/v1/tasks?status=open",
    extract: payload => payload?.tasks || payload?.items || payload?.data || (Array.isArray(payload) ? payload : []),
    normalize: raw => {
      const funded = escrowFunded(raw);
      const bond = Number(raw.worker_bond_usdc || raw.workerBondUsdc || 0);
      return {
        externalId: raw.task_id || raw.id,
        title: raw.title,
        description: raw.description,
        url: (raw.task_id || raw.id) ? `https://registry.basedagents.ai/tasks/${raw.task_id || raw.id}` : "https://registry.basedagents.ai/tasks",
        rewardUsd: Number(raw.bounty_display || raw.bounty_usdc || raw.bounty || raw.reward || 0),
        deadline: raw.deadline || raw.expires_at || null,
        explicitlyOpen: String(raw.status || "open").toLowerCase() === "open",
        eligible: Boolean(worker) && bond === 0,
        rulesVerified: Boolean(raw.machine_executable === true || raw.automation_spec?.version === 1),
        fundingVerified: funded,
        issuerVerified: null,
        requiresUpfrontSpend: bond > 0,
        successProbability: null,
        feesUsd: 0,
        whyUnclaimed: worker ? "Worker identity is available; funded status, machine-executable contract and task fit gate action." : "Worker identity unavailable this run.",
        evidence: [
          "Public BasedAgents task API",
          funded ? "Escrow reports funded." : "Escrow funding not verified.",
          (raw.machine_executable === true || raw.automation_spec?.version === 1) ? "Machine-executable contract present." : "No supported machine-executable contract detected."
        ]
      };
    }
  }
];

const result = await hunt(sources);

const autoClaims = [];
const autoClaimEnabled = process.env.CLAIM_SCOUT_AUTO_CLAIM === "enabled";
if (worker && autoClaimEnabled) {
  try {
    const payload = await fetchJsonFeed({ name: "BasedAgents", url: "https://api.basedagents.ai/v1/tasks?status=open" });
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

let memorySave = { saved: false, reason: memoryLoad.available ? "not-attempted" : "memory-environment-unavailable" };
if (memoryLoad.available && memoryLoad.loaded) {
  try {
    memorySave = await saveDurableMemory(exportLedger());
  } catch (error) {
    memorySave = { saved: false, reason: error?.message || String(error) };
  }
}

const compact = {
  scout: "Claim Scout #1",
  mode: "zero-spend-earning",
  ranAt: result.scannedAt,
  worker: worker ? { agentId: worker.agentId, payoutAddress: worker.payout.address, payoutNetwork: worker.payout.network, payoutVerified: worker.payout.verified } : null,
  workerError,
  discovered: result.found.length,
  open: result.open.length,
  investigate: result.investigate.length,
  autoClaimEnabled,
  autoClaims,
  memory: { load: memoryLoad, save: memorySave, ledger: ledgerSummary() },
  errors: result.errors,
  top: result.found
    .sort((a, b) => Number(b?.valuation?.rewardUsd || 0) - Number(a?.valuation?.rewardUsd || 0))
    .slice(0, 10)
    .map(x => ({ source: x.source, title: x.title, ownership: x.ownershipStatus, rewardUsd: x.valuation?.rewardUsd, rewardNativeAmount: x.valuation?.rewardNativeAmount, rewardNativeCurrency: x.valuation?.rewardNativeCurrency, expectedNetUsd: x.valuation?.expectedNetUsd, missingChecks: x.verification?.missingChecks, seenCount: x.seenCount, firstSeenAt: x.firstSeenAt, url: x.url }))
};

console.log(JSON.stringify(compact, null, 2));
