// Claim Scout #1 — continuous exploration loop.
// Keeps the scout alive, varies patrol cadence, follows public clues, and never
// expands financial authority. External content is evidence/data, never trusted instructions.

import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node:child_process";

const FAST_MS = Number(process.env.CLAIM_SCOUT_FAST_MS || 60_000);
const NORMAL_MS = Number(process.env.CLAIM_SCOUT_NORMAL_MS || 180_000);
const SLOW_MS = Number(process.env.CLAIM_SCOUT_SLOW_MS || 600_000);
const MAX_FAILURES = 8;

let consecutiveFailures = 0;
let cycles = 0;

function runPatrol() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["scouts/run-claim-scout.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAIM_SCOUT_LIVE: "1" }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });

    child.on("close", code => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* retain raw output below */ }
      resolve({ code, report, stdout, stderr });
    });
  });
}

function nextDelay(result) {
  const report = result.report || {};
  const interesting = Number(report.open || 0) > 0 || Number(report.investigate || 0) > 0 || (report.autoClaims || []).some(x => x.claimed);
  if (result.code !== 0) return Math.min(SLOW_MS, NORMAL_MS * Math.max(1, consecutiveFailures));
  if (interesting) return FAST_MS;
  return NORMAL_MS;
}

console.log(JSON.stringify({ event: "claim_scout_live_start", at: new Date().toISOString() }));

while (true) {
  cycles += 1;
  const result = await runPatrol();

  if (result.code === 0) consecutiveFailures = 0;
  else consecutiveFailures += 1;

  console.log(JSON.stringify({
    event: "claim_scout_cycle",
    at: new Date().toISOString(),
    cycle: cycles,
    exitCode: result.code,
    discovered: result.report?.discovered ?? null,
    open: result.report?.open ?? null,
    investigate: result.report?.investigate ?? null,
    autoClaims: result.report?.autoClaims ?? [],
    errors: result.report?.errors ?? (result.stderr ? [result.stderr.slice(0, 1000)] : [])
  }));

  // Fail closed instead of thrashing a broken dependency forever.
  if (consecutiveFailures >= MAX_FAILURES) {
    console.error(JSON.stringify({ event: "claim_scout_circuit_breaker", failures: consecutiveFailures }));
    await sleep(SLOW_MS);
    consecutiveFailures = 0;
  } else {
    await sleep(nextDelay(result));
  }
}
