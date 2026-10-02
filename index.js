import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAY_TO = process.env.PAY_TO;
const NETWORK = process.env.X402_NETWORK || "eip155:84532";
const PRICE = process.env.SIGNAL_PRICE || "$0.01";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

app.get("/", (_req, res) => res.json({
  service: "Agent Market x402",
  product: "Signal Snapshot V0",
  status: PAY_TO ? "ready" : "awaiting_pay_to",
  network: NETWORK,
  price: PRICE
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

if (PAY_TO) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator);
  server.register(NETWORK, new ExactEvmScheme());

  app.use(paymentMiddleware({
    "GET /signal": {
      accepts: {
        scheme: "exact",
        price: PRICE,
        network: NETWORK,
        payTo: PAY_TO
      },
      description: "Machine-readable market attention and anomaly snapshot for an asset.",
      mimeType: "application/json"
    }
  }, server));
}

app.get("/signal", (req, res) => {
  if (!PAY_TO) return res.status(503).json({
    error: "payment_not_configured",
    message: "PAY_TO must be configured before paid access is enabled."
  });

  const asset = String(req.query.asset || "CRO").toUpperCase();
  res.json({
    product: "Signal Snapshot V0",
    asset,
    attention_score: 50,
    attention_change: 0,
    price_change: 0,
    volume_anomaly: 0,
    signal: "TEST_BASELINE",
    freshness: new Date().toISOString(),
    confidence: 0,
    notice: "V0 plumbing test data; live signal sources are not connected yet."
  });
});

app.listen(PORT, () => console.log(`Agent Market x402 listening on port ${PORT}`));
