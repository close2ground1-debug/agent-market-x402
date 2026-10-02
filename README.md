# Agent Market x402

Signal Snapshot V0 is an experimental machine-to-machine API for x402 payments.

## Endpoints
- `GET /health` — free health check
- `GET /signal?asset=CRO` — x402-gated signal snapshot once `PAY_TO` is configured

## Environment
- `PAY_TO` — receiving EVM wallet address (required for payments)
- `X402_NETWORK` — defaults to Base Sepolia (`eip155:84532`)
- `SIGNAL_PRICE` — defaults to `$0.01`
- `X402_FACILITATOR_URL` — defaults to `https://x402.org/facilitator`

V0 returns clearly labeled test data. Live signal sources are not connected yet.
