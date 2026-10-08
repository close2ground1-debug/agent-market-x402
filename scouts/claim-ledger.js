// Claim Scout #1 — opportunity/payout ledger.
// Runtime state can be hydrated from a durable notebook. No secrets or signing
// authority belong here.

const opportunities = new Map();
const receipts = [];
const sourceStats = {};
const outcomes = [];

function idFor(item = {}) {
  const source = String(item.source || "unknown");
  const externalId = String(item.externalId || item.url || item.title || "unknown");
  return `${source}::${externalId}`;
}

export function hydrateLedger(state = {}) {
  opportunities.clear();
  receipts.length = 0;
  outcomes.length = 0;
  for (const key of Object.keys(sourceStats)) delete sourceStats[key];

  const saved = state?.opportunities || {};
  for (const [id, record] of Object.entries(saved)) {
    opportunities.set(id, { ...record, id });
  }
  if (Array.isArray(state?.receipts)) receipts.push(...state.receipts);
  if (Array.isArray(state?.outcomes)) outcomes.push(...state.outcomes);
  if (state?.sourceStats && typeof state.sourceStats === "object") {
    Object.assign(sourceStats, state.sourceStats);
  }
}

export function rememberOpportunity(item = {}) {
  const id = idFor(item);
  const previous = opportunities.get(id);
  const now = new Date().toISOString();
  const record = {
    ...previous,
    ...item,
    id,
    firstSeenAt: previous?.firstSeenAt || now,
    lastSeenAt: now,
    seenCount: (previous?.seenCount || 0) + 1
  };
  opportunities.set(id, record);

  const source = String(item.source || "unknown");
  const prior = sourceStats[source] || { observations: 0, unique: 0 };
  sourceStats[source] = {
    ...prior,
    observations: Number(prior.observations || 0) + 1,
    unique: Number(prior.unique || 0) + (previous ? 0 : 1),
    lastSeenAt: now
  };
  return record;
}

export function listOpportunities() {
  return [...opportunities.values()].sort((a, b) =>
    Number(b?.valuation?.expectedNetUsd || 0) - Number(a?.valuation?.expectedNetUsd || 0)
  );
}

export function recordReceipt(receipt = {}) {
  const record = {
    receivedAt: new Date().toISOString(),
    amountUsd: Number(receipt.amountUsd || 0),
    asset: receipt.asset || "USDC",
    network: receipt.network || null,
    txHash: receipt.txHash || null,
    opportunityId: receipt.opportunityId || null,
    source: receipt.source || null
  };
  receipts.push(record);
  return record;
}

export function recordOutcome(outcome = {}) {
  const record = { recordedAt: new Date().toISOString(), ...outcome };
  outcomes.push(record);
  return record;
}

export function exportLedger() {
  return {
    schema: 1,
    opportunities: Object.fromEntries(opportunities),
    sourceStats: { ...sourceStats },
    outcomes: [...outcomes],
    receipts: [...receipts],
    updatedAt: new Date().toISOString()
  };
}

export function ledgerSummary() {
  return {
    opportunities: opportunities.size,
    receipts: receipts.length,
    outcomes: outcomes.length,
    sources: Object.keys(sourceStats).length,
    receivedUsd: receipts.reduce((sum, r) => sum + Number(r.amountUsd || 0), 0)
  };
}
