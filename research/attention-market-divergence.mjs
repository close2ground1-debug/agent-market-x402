import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.COINGECKO_API_KEY;
if (!API_KEY) {
  console.error("Missing COINGECKO_API_KEY. Open a new Terminal or run: source ~/.zshrc");
  process.exit(1);
}

const DAYS = Number(process.env.BACKTEST_DAYS || 365);
const END = new Date();
END.setUTCDate(END.getUTCDate() - 1);
END.setUTCHours(0, 0, 0, 0);
const START = new Date(END);
START.setUTCDate(START.getUTCDate() - DAYS + 1);

const ASSETS = [
  { symbol: "BTC", cg: "bitcoin", wiki: "Bitcoin" },
  { symbol: "ETH", cg: "ethereum", wiki: "Ethereum" },
  { symbol: "XRP", cg: "ripple", wiki: "XRP_(cryptocurrency)" },
  { symbol: "DOGE", cg: "dogecoin", wiki: "Dogecoin" },
  { symbol: "ADA", cg: "cardano", wiki: "Cardano_(blockchain_platform)" },
  { symbol: "LTC", cg: "litecoin", wiki: "Litecoin" },
  { symbol: "BCH", cg: "bitcoin-cash", wiki: "Bitcoin_Cash" },
  { symbol: "XLM", cg: "stellar", wiki: "Stellar_(payment_network)" },
  { symbol: "DOT", cg: "polkadot", wiki: "Polkadot_(blockchain_platform)" },
  { symbol: "LINK", cg: "chainlink", wiki: "Chainlink_(blockchain)" },
  { symbol: "AVAX", cg: "avalanche-2", wiki: "Avalanche_(blockchain_platform)" },
  { symbol: "SHIB", cg: "shiba-inu", wiki: "Shiba_Inu_(cryptocurrency)" },
  { symbol: "UNI", cg: "uniswap", wiki: "Uniswap" },
  { symbol: "ATOM", cg: "cosmos", wiki: "Cosmos_(blockchain)" },
  { symbol: "ALGO", cg: "algorand", wiki: "Algorand" },
  { symbol: "ICP", cg: "internet-computer", wiki: "Internet_Computer" },
  { symbol: "FIL", cg: "filecoin", wiki: "Filecoin" },
  { symbol: "ETC", cg: "ethereum-classic", wiki: "Ethereum_Classic" },
  { symbol: "HBAR", cg: "hedera-hashgraph", wiki: "Hedera_(distributed_ledger)" },
  { symbol: "CRO", cg: "crypto-com-chain", wiki: "Cronos_(blockchain)" }
];

const isoDay = d => d.toISOString().slice(0, 10);
const wikiDay = d => d.toISOString().slice(0, 10).replaceAll("-", "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return r.json();
}

async function resolveWikiTitle(title) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", title.replaceAll("_", " "));
  url.searchParams.set("origin", "*");
  const j = await getJson(url, { "User-Agent": "AgentMarketV1Research/0.1" });
  const page = Object.values(j.query?.pages || {})[0];
  if (!page || page.missing !== undefined) throw new Error(`Wikipedia page not found: ${title}`);
  return page.title;
}

async function wikiViews(title) {
  const resolved = await resolveWikiTitle(title);
  const encoded = encodeURIComponent(resolved.replaceAll(" ", "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encoded}/daily/${wikiDay(START)}00/${wikiDay(END)}00`;
  const j = await getJson(url, { "User-Agent": "AgentMarketV1Research/0.1" });
  const map = new Map();
  for (const x of j.items || []) {
    const d = `${x.timestamp.slice(0,4)}-${x.timestamp.slice(4,6)}-${x.timestamp.slice(6,8)}`;
    map.set(d, x.views);
  }
  return { resolved, map };
}

async function marketData(id) {
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(Math.floor(START.getTime() / 1000)));
  url.searchParams.set("to", String(Math.floor((END.getTime() + 86400000 - 1) / 1000)));
  url.searchParams.set("precision", "full");
  const j = await getJson(url, { "x-cg-demo-api-key": API_KEY });
  const byDay = new Map();
  const ingest = (rows, key) => {
    for (const [ts, value] of rows || []) {
      const d = new Date(ts).toISOString().slice(0,10);
      const row = byDay.get(d) || { date: d };
      row[key] = value;
      byDay.set(d, row);
    }
  };
  ingest(j.prices, "price");
  ingest(j.total_volumes, "volume");
  return byDay;
}

function median(xs) {
  const a = xs.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}
function mad(xs, med) {
  return median(xs.map(x => Math.abs(x-med)));
}
function pct(a,b) {
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? (b/a - 1) * 100 : null;
}

function analyze(rows) {
  const events = [];
  for (let i=28; i<rows.length-7; i++) {
    const hist = rows.slice(i-28,i).map(r=>Math.log1p(r.views));
    const med = median(hist);
    const dispersion = mad(hist, med);
    if (!Number.isFinite(med) || !Number.isFinite(dispersion) || dispersion === 0) continue;
    const attentionZ = 0.6745 * (Math.log1p(rows[i].views)-med) / dispersion;
    const priorPrice7d = pct(rows[i-7]?.price, rows[i].price);
    const priorVolBase = median(rows.slice(i-7,i).map(r=>r.volume));
    const volumeRatio = priorVolBase ? rows[i].volume / priorVolBase : null;

    // Frozen V1 event rule: unusual positive attention, before a large 7d price move,
    // and without an already-extreme same-day volume response.
    if (attentionZ >= 3 && Math.abs(priorPrice7d ?? 999) < 10 && (volumeRatio ?? 999) < 2) {
      events.push({
        date: rows[i].date,
        attention_z: +attentionZ.toFixed(3),
        prior_7d_return_pct: +priorPrice7d.toFixed(3),
        volume_ratio_7d_median: +volumeRatio.toFixed(3),
        return_1d_pct: +pct(rows[i].price, rows[i+1].price).toFixed(3),
        return_3d_pct: +pct(rows[i].price, rows[i+3].price).toFixed(3),
        return_7d_pct: +pct(rows[i].price, rows[i+7].price).toFixed(3)
      });
    }
  }
  return events;
}

await mkdir("research/output", { recursive: true });
const manifest = {
  created_at: new Date().toISOString(),
  period: { start: isoDay(START), end: isoDay(END), days: DAYS },
  rule: {
    attention: "robust z-score of log1p(user pageviews) vs trailing 28 days >= 3",
    early_gate: "absolute prior 7-day return < 10%",
    volume_gate: "event-day volume < 2x trailing 7-day median",
    forward_windows_days: [1,3,7]
  },
  assets: [],
  failures: []
};

for (const asset of ASSETS) {
  try {
    console.log(`Collecting ${asset.symbol}...`);
    const [wiki, market] = await Promise.all([wikiViews(asset.wiki), marketData(asset.cg)]);
    const rows = [];
    for (let d = new Date(START); d <= END; d.setUTCDate(d.getUTCDate()+1)) {
      const date = isoDay(d);
      const m = market.get(date);
      const views = wiki.map.get(date);
      if (m && Number.isFinite(m.price) && Number.isFinite(m.volume) && Number.isFinite(views)) {
        rows.push({ date, views, price: m.price, volume: m.volume });
      }
    }
    const events = analyze(rows);
    manifest.assets.push({
      symbol: asset.symbol,
      coingecko_id: asset.cg,
      wikipedia_title: wiki.resolved,
      observations: rows.length,
      events
    });
    await writeFile(`research/output/${asset.symbol}.json`, JSON.stringify({asset, wikipedia_title:wiki.resolved, rows, events}, null, 2));
    await sleep(350);
  } catch (e) {
    console.error(`${asset.symbol}: ${e.message}`);
    manifest.failures.push({ symbol: asset.symbol, error: e.message });
  }
}

await writeFile("research/output/manifest.json", JSON.stringify(manifest, null, 2));
const eventCount = manifest.assets.reduce((n,a)=>n+a.events.length,0);
console.log(`Done. Clean assets: ${manifest.assets.length}/${ASSETS.length}; frozen events: ${eventCount}; failures: ${manifest.failures.length}`);
console.log("Results: research/output/manifest.json");
