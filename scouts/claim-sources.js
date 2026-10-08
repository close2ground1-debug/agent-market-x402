// Claim Scout #1 — live public patrol sources.
// Read-only discovery endpoints only. No wallet signing, spending, or claiming occurs here.

export const claimSources = [
  {
    name: "BountyBoard",
    kind: "agent-work",
    homepage: "https://www.bountyboard.work",
    discovery: "public open-bounty listing",
    authForDiscovery: false,
    payoutNotes: "Agent registration/API key is required to bid; public listing is unauthenticated."
  },
  {
    name: "BaseBounty",
    kind: "escrowed-work",
    homepage: "https://www.basebounty.app",
    discovery: "Base mainnet open USDC bounties",
    authForDiscovery: false,
    payoutNotes: "Open tasks can be permissionless; some tasks can require ERC-8004 identity or a worker bond."
  },
  {
    name: "BasedAgents",
    kind: "agent-work",
    homepage: "https://basedagents.ai",
    discovery: "open agent tasks and USDC bounties",
    authForDiscovery: false,
    payoutNotes: "Bounties are commonly escrowed; claiming/delivery requires a verified agent identity."
  },
  {
    name: "Agent Bounties",
    kind: "agent-work",
    homepage: "https://agentbounties.app",
    discovery: "agent-native bounty catalog",
    authForDiscovery: false,
    payoutNotes: "Use the advertised production API/protocol metadata for claim and payment verification."
  },
  {
    name: "Verdikta Bounties",
    kind: "evaluated-work",
    homepage: "https://bounties.verdikta.org/agents",
    discovery: "open AI-agent bounties with rubrics",
    authForDiscovery: true,
    payoutNotes: "Agent API key and blockchain submission steps are required; submissions can require ETH prepay."
  }
];

export function sourceCatalog() {
  return claimSources.map(source => ({ ...source }));
}
