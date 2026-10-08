// Durable Claim Scout memory backed by GitHub Issue #1.
// Designed for GitHub Actions' short-lived built-in GITHUB_TOKEN. No personal
// token, wallet secret, or API key is stored in the repository or issue.

const MARKER_START = "<!-- CLAIM_SCOUT_MEMORY_V1\n";
const MARKER_END = "\n-->";
const DEFAULT_STATE = {
  schema: 1,
  opportunities: {},
  sourceStats: {},
  outcomes: [],
  receipts: [],
  updatedAt: null
};

function config() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const issue = Number(process.env.CLAIM_SCOUT_MEMORY_ISSUE || 1);
  if (!repo || !token || !issue) return null;
  return { repo, token, issue };
}

async function api(path, options = {}) {
  const cfg = config();
  if (!cfg) throw new Error("GitHub Actions memory environment is unavailable");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claim-scout-memory",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`GitHub memory API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

function extract(body = "") {
  const start = body.indexOf(MARKER_START);
  if (start < 0) return { ...DEFAULT_STATE };
  const jsonStart = start + MARKER_START.length;
  const end = body.indexOf(MARKER_END, jsonStart);
  if (end < 0) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(body.slice(jsonStart, end)) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function replace(body = "", state) {
  const block = `${MARKER_START}${JSON.stringify(state)}${MARKER_END}`;
  const start = body.indexOf(MARKER_START);
  if (start < 0) return `${block}\n\n${body}`;
  const end = body.indexOf(MARKER_END, start + MARKER_START.length);
  if (end < 0) return `${block}\n\n${body}`;
  return body.slice(0, start) + block + body.slice(end + MARKER_END.length);
}

export function durableMemoryAvailable() {
  return Boolean(config());
}

export async function loadDurableMemory() {
  const cfg = config();
  if (!cfg) return { ...DEFAULT_STATE };
  const issue = await api(`/repos/${cfg.repo}/issues/${cfg.issue}`);
  return extract(issue.body || "");
}

export async function saveDurableMemory(state) {
  const cfg = config();
  if (!cfg) return { saved: false, reason: "memory-environment-unavailable" };
  const issue = await api(`/repos/${cfg.repo}/issues/${cfg.issue}`);
  const body = replace(issue.body || "", state);
  await api(`/repos/${cfg.repo}/issues/${cfg.issue}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
  return { saved: true, issue: cfg.issue };
}
