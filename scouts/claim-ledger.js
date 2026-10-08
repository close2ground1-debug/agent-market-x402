// Claim Scout #1 — opportunity/payout ledger.
// In-memory V1. No secrets and no signing authority live here.

const opportunities = new Map();
const receipts = [];

function idFor(item = {}) {
  const source = String(item.source || "unknown");
  const externalId = String(item.externalId || item.url || item.title || "unknown");
  return `${source}::${externalId}`;
}

export function rememberOpportunity(item = {}) {
  const id = idFor(item);
  const previous = opportunities.get(id);
  const record = {
    ...previous,
    ...item,
    id,
    firstSeenAt: previous?.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    seenCount: (previous?.seenCount || 0) + 1
  };
  opportunities.set(id, record);
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

export function ledgerSummary() {
  return {
    opportunities: opportunities.size,
    receipts: receipts.length,
    receivedUsd: receipts.reduce((sum, r) => sum + Number(r.amountUsd || 0), 0)
  };
}
