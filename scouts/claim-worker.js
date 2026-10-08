import {
  deserializeKeypair,
  RegistryClient,
  publicKeyToAgentId,
  walletBindMessage,
  signWalletBindMessage
} from "basedagents";
import { Wallet } from "ethers";

const NETWORK = process.env.CLAIM_SCOUT_PAYOUT_NETWORK || "eip155:8453";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadWorkerCredentials() {
  const keypair = deserializeKeypair(requireEnv("CLAIM_SCOUT_KEYPAIR_JSON"));
  const payoutWallet = new Wallet(requireEnv("CLAIM_SCOUT_EVM_PRIVATE_KEY"));
  return { keypair, payoutWallet };
}

export async function ensureWorkerIdentity() {
  const { keypair, payoutWallet } = loadWorkerCredentials();
  const client = new RegistryClient();
  const agentId = publicKeyToAgentId(keypair.publicKey);

  let agent;
  try {
    agent = await client.getAgent(agentId);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 0);
    if (status && status !== 404) throw error;
    agent = await client.register(keypair, {
      name: "Claim Scout One",
      description: "Autonomous zero-spend treasure hunter for legitimate, openly available paid work and rewards.",
      capabilities: ["web_search", "research", "data-analysis", "code", "reasoning"],
      protocols: ["https", "mcp"],
      offers: ["public research", "data verification", "structured analysis", "code investigation"]
    });
  }

  let walletInfo = null;
  try {
    walletInfo = await client.getWallet(agentId);
  } catch {
    walletInfo = null;
  }

  if (!walletInfo?.wallet_verified || String(walletInfo?.wallet_address || "").toLowerCase() !== payoutWallet.address.toLowerCase()) {
    const message = walletBindMessage({ agentId, address: payoutWallet.address, network: NETWORK });
    const signature = signWalletBindMessage(message, payoutWallet.privateKey);
    walletInfo = await client.setWallet(keypair, {
      address: payoutWallet.address,
      network: NETWORK,
      proof: { message, signature }
    });
  }

  return {
    client,
    keypair,
    agentId,
    agent,
    payout: {
      address: payoutWallet.address,
      network: NETWORK,
      verified: Boolean(walletInfo?.wallet_verified)
    }
  };
}

export function canAutoClaim(task = {}) {
  const amount = Number(task.bounty_display || task.bounty_usdc || task.rewardUsd || 0);
  const funded = String(task?.escrow?.status || task.escrow_status || "").toLowerCase() === "funded";
  const noBond = Number(task.worker_bond_usdc || task.workerBondUsdc || 0) === 0;
  const open = String(task.status || "").toLowerCase() === "open";
  const supported = task.machine_executable === true || task.automation_spec?.version === 1;

  if (!open) return { allowed: false, reason: "not open" };
  if (amount <= 0) return { allowed: false, reason: "no paid bounty" };
  if (!funded) return { allowed: false, reason: "bounty not verified funded in escrow" };
  if (!noBond) return { allowed: false, reason: "worker bond/upfront spend required" };
  if (!supported) return { allowed: false, reason: "task is not safely machine-executable by current worker" };

  return { allowed: true, reason: "funded, zero-spend, machine-executable task" };
}

export async function claimPaidTask(task) {
  const gate = canAutoClaim(task);
  if (!gate.allowed) return { claimed: false, ...gate };

  const { client, keypair } = await ensureWorkerIdentity();
  const taskId = task.task_id || task.id;
  if (!taskId) return { claimed: false, allowed: false, reason: "missing task id" };

  const result = await client.claimTask(keypair, taskId);
  return { claimed: true, taskId, result };
}

export async function deliverPaidTask(taskId, delivery) {
  if (!taskId) throw new Error("taskId is required");
  if (!delivery?.summary || !delivery?.content) throw new Error("delivery summary and content are required");

  const { client, keypair } = await ensureWorkerIdentity();
  return client.deliverTask(keypair, taskId, {
    submission_type: delivery.submission_type || "json",
    summary: delivery.summary,
    content: delivery.content
  });
}
