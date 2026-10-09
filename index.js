import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { claimScout } from "./scouts/claim-scout.js";
import { hydrateLedger, ledgerSummary, listOpportunities } from "./scouts/claim-ledger.js";
import { durableMemoryAvailable, loadDurableMemory } from "./scouts/claim-memory.js";

const app = express();
app.use(express.json());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const PAY_TO = process.env.PAY_TO;
const NETWORK = process.env.X402_NETWORK || "eip155:84532";
const PRICE = process.env.SIGNAL_PRICE || "$0.01";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

app.get("/", (_req, res) => res.json({ service: "Agent Market x402", product: "Signal Snapshot V0", claimScout: { name: claimScout.name, mode: claimScout.mode }, indianaDashboard: "/indiana.html", status: PAY_TO ? "ready" : "awaiting_pay_to", network: NETWORK, price: PRICE }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/claim-scout", (_req, res) => res.json({ name: claimScout.name, mode: claimScout.mode, receivingConfigured: Boolean(PAY_TO), network: NETWORK, ledger: ledgerSummary() }));
app.get("/claim-scout/opportunities", (_req, res) => res.json({ opportunities: listOpportunities() }));

// Read-only Indiana dashboard feed. Hydrates from the same durable expedition
// memory used by scheduled patrols, so the web process does not show an empty,
// separate in-memory ledger.
app.get("/indiana/data", async (_req, res) => {
  try {
    if (durableMemoryAvailable()) hydrateLedger(await loadDurableMemory());
    const summary = ledgerSummary();
    const all = listOpportunities();
    const lastPatrolAt = all.map(x => x.lastSeenAt).filter(Boolean).sort().at(-1) || null;
    const investigating = all.filter(x => x.ownershipStatus === "INVESTIGATE");
    const verifiedOpen = all.filter(x => x.ownershipStatus === "OPEN");
    const rejected = all.filter(x => x.ownershipStatus === "HANDS_OFF");
    const currentCave = investigating
      .slice()
      .sort((a,b) => Number(b.seenCount||0)-Number(a.seenCount||0) || Number(b?.valuation?.rewardUsd||0)-Number(a?.valuation?.rewardUsd||0))[0] || null;
    const view = x => x ? ({ title:x.title, ownership:x.ownershipStatus, rewardUsd:x?.valuation?.rewardUsd ?? null, rewardNativeAmount:x?.valuation?.rewardNativeAmount ?? x.rewardNativeAmount ?? null, rewardNativeCurrency:x?.valuation?.rewardNativeCurrency ?? x.rewardNativeCurrency ?? null, seenCount:x.seenCount||0, missingChecks:x?.verification?.missingChecks||[], url:x.url||null, lastSeenAt:x.lastSeenAt||null }) : null;
    res.set("Cache-Control", "no-store");
    res.json({ scout:"Indiana", lastPatrolAt, patrols:Object.values(all).reduce((n,x)=>n+Number(x.seenCount||0),0), uniqueFinds:all.length, investigating:investigating.length, verifiedOpen:verifiedOpen.length, rejected:rejected.length, receivedUsd:summary.receivedUsd, currentCave:view(currentCave), recent:all.slice().sort((a,b)=>String(b.lastSeenAt||'').localeCompare(String(a.lastSeenAt||''))).slice(0,8).map(view) });
  } catch (error) {
    res.status(503).json({ error:"indiana_memory_unavailable", message:error?.message||String(error) });
  }
});

if (PAY_TO) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator);
  server.register(NETWORK, new ExactEvmScheme());
  app.use(paymentMiddleware({ "GET /signal": { accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO }, description: "Machine-readable crypto market attention, price-change, volume-anomaly, and signal snapshot for a requested asset.", mimeType: "application/json", extensions: { ...declareDiscoveryExtension({ input: { asset: "CRO" }, inputSchema: { properties: { asset: { type: "string", description: "Crypto asset ticker symbol, for example CRO." } }, required: ["asset"] }, output: { example: { product: "Signal Snapshot V0", asset: "CRO", attention_score: 50, attention_change: 0, price_change: 0, volume_anomaly: 0, signal: "TEST_BASELINE", freshness: "2026-10-02T20:19:12.223Z", confidence: 0, notice: "V0 plumbing test data; live signal sources are not connected yet." }, schema: { type: "object", properties: { product: { type: "string" }, asset: { type: "string" }, attention_score: { type: "number" }, attention_change: { type: "number" }, price_change: { type: "number" }, volume_anomaly: { type: "number" }, signal: { type: "string" }, freshness: { type: "string" }, confidence: { type: "number" }, notice: { type: "string" } } } } }) } } }, server));
}

app.get("/signal", (req, res) => {
  if (!PAY_TO) return res.status(503).json({ error: "payment_not_configured", message: "PAY_TO must be configured before paid access is enabled." });
  const asset = String(req.query.asset || "CRO").toUpperCase();
  res.json({ product: "Signal Snapshot V0", asset, attention_score: 50, attention_change: 0, price_change: 0, volume_anomaly: 0, signal: "TEST_BASELINE", freshness: new Date().toISOString(), confidence: 0, notice: "V0 plumbing test data; live signal sources are not connected yet." });
});

app.listen(PORT, () => console.log(`Agent Market x402 listening on port ${PORT}`));
