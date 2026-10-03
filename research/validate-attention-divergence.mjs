import { readdir, readFile, writeFile } from "node:fs/promises";

const OUT = "research/output";
const MIN_PRIMARY_OBS = 300;
const EPISODE_GAP_DAYS = 3;
const BOOTSTRAPS = 10000;

const median = xs => {
  const a = xs.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
};
const mean = xs => {
  const a = xs.filter(Number.isFinite);
  return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
};
const pct = (a,b) => Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? (b/a-1)*100 : null;
const daysBetween = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/86400000);
const round = x => Number.isFinite(x) ? +x.toFixed(3) : null;

function summarize(xs) {
  const a = xs.filter(Number.isFinite);
  return {
    n: a.length,
    median: round(median(a)),
    mean: round(mean(a)),
    positive_pct: a.length ? round(100*a.filter(x=>x>0).length/a.length) : null
  };
}

function dedupeEpisodes(events) {
  const sorted = [...events].sort((a,b)=>a.date.localeCompare(b.date));
  const out = [];
  let last = null;
  for (const e of sorted) {
    if (!last || daysBetween(last.date, e.date) > EPISODE_GAP_DAYS) {
      out.push(e);
      last = e;
    }
  }
  return out;
}

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bootstrapAssetBalanced(assetValues, reps=BOOTSTRAPS, seed=402) {
  const vals = assetValues.filter(Number.isFinite);
  if (vals.length < 2) return { assets: vals.length, mean: round(mean(vals)), ci95: [null,null] };
  const rand = mulberry32(seed);
  const sims = [];
  for (let r=0;r<reps;r++) {
    let s=0;
    for (let i=0;i<vals.length;i++) s += vals[Math.floor(rand()*vals.length)];
    sims.push(s/vals.length);
  }
  sims.sort((a,b)=>a-b);
  return {
    assets: vals.length,
    mean: round(mean(vals)),
    ci95: [round(sims[Math.floor(0.025*reps)]), round(sims[Math.floor(0.975*reps)])]
  };
}

function rowMap(rows) { return new Map(rows.map(r=>[r.date,r])); }

function enrichEvents(file) {
  const byDate = rowMap(file.rows);
  return file.events.map(e => {
    const i = file.rows.findIndex(r=>r.date===e.date);
    return {
      ...e,
      symbol: file.asset.symbol,
      return_1d_pct: e.return_1d_pct ?? pct(file.rows[i]?.price,file.rows[i+1]?.price),
      return_3d_pct: e.return_3d_pct ?? pct(file.rows[i]?.price,file.rows[i+3]?.price),
      return_7d_pct: e.return_7d_pct ?? pct(file.rows[i]?.price,file.rows[i+7]?.price),
      _row: byDate.get(e.date)
    };
  });
}

const files = (await readdir(OUT)).filter(x=>x.endsWith(".json") && x !== "manifest.json" && x !== "validation-report.json");
const assets = [];
for (const fn of files) {
  const j = JSON.parse(await readFile(`${OUT}/${fn}`,"utf8"));
  if (!j?.asset?.symbol || !Array.isArray(j.rows) || !Array.isArray(j.events)) continue;
  assets.push({ ...j, observations:j.rows.length });
}

const btc = assets.find(a=>a.asset.symbol==="BTC");
if (!btc) throw new Error("BTC.json missing; cannot compute market-adjusted returns.");
const btcRows = rowMap(btc.rows);

function btcForward(date, days) {
  const i = btc.rows.findIndex(r=>r.date===date);
  if (i<0 || !btc.rows[i+days]) return null;
  return pct(btc.rows[i].price, btc.rows[i+days].price);
}

const primary = assets.filter(a=>a.observations>=MIN_PRIMARY_OBS);
const sensitivity = assets.filter(a=>a.observations>=100);
const excluded = assets.filter(a=>a.observations<MIN_PRIMARY_OBS).map(a=>({
  symbol:a.asset.symbol, observations:a.observations,
  reason:`fewer than ${MIN_PRIMARY_OBS} aligned daily observations`
}));

function analyzeSet(set) {
  const allEvents = set.flatMap(enrichEvents);
  const episodes = set.flatMap(a=>dedupeEpisodes(enrichEvents(a)));

  const windows = [1,3,7];
  const pooled = {};
  const episodePooled = {};
  const assetBalanced = {};
  const marketAdjusted = {};
  const bootstrap = {};

  for (const d of windows) {
    const key = `return_${d}d_pct`;
    pooled[`${d}d`] = summarize(allEvents.map(e=>e[key]));
    episodePooled[`${d}d`] = summarize(episodes.map(e=>e[key]));

    const assetMeans = set.map(a => {
      const ev = dedupeEpisodes(enrichEvents(a));
      return mean(ev.map(e=>e[key]));
    }).filter(Number.isFinite);
    assetBalanced[`${d}d`] = summarize(assetMeans);
    bootstrap[`${d}d`] = bootstrapAssetBalanced(assetMeans, BOOTSTRAPS, 402+d);

    const adjusted = episodes
      .filter(e=>e.symbol!=="BTC")
      .map(e => Number.isFinite(e[key]) && Number.isFinite(btcForward(e.date,d)) ? e[key]-btcForward(e.date,d) : null);
    marketAdjusted[`${d}d`] = summarize(adjusted);
  }

  return {
    assets:set.map(a=>({symbol:a.asset.symbol, observations:a.observations, raw_events:a.events.length, episodes:dedupeEpisodes(enrichEvents(a)).length})),
    raw_event_count:allEvents.length,
    episode_count:episodes.length,
    episode_rule:`keep first qualifying event; start a new episode only after >${EPISODE_GAP_DAYS} calendar days`,
    pooled_raw_events:pooled,
    pooled_episode_events:episodePooled,
    asset_balanced_episode_means:assetBalanced,
    bootstrap_asset_balanced_episode_mean:bootstrap,
    btc_adjusted_non_btc_episode_returns:marketAdjusted
  };
}

const report = {
  created_at:new Date().toISOString(),
  methodology:{
    frozen_signal_rule:"unchanged from collector output",
    primary_completeness_rule:`>= ${MIN_PRIMARY_OBS} aligned observations, chosen for data completeness rather than outcomes`,
    episode_deduplication:`collapse signal clusters using a >${EPISODE_GAP_DAYS}-day gap before a new episode`,
    asset_balance:"average episode return within each asset, then summarize assets equally",
    market_adjustment:"for non-BTC assets, subtract BTC forward return over the same horizon",
    bootstrap:`${BOOTSTRAPS} deterministic asset-level bootstrap resamples; descriptive CI, not a causal significance test`,
    warning:"Daily Wikipedia attention cannot establish intraday lead/lag. Results are associative and exploratory."
  },
  primary:analyzeSet(primary),
  sensitivity_ge_100_observations:analyzeSet(sensitivity),
  excluded_from_primary:excluded,
  missing_from_run:["ICP","CRO"].filter(s=>!assets.some(a=>a.asset.symbol===s))
};

await writeFile(`${OUT}/validation-report.json`, JSON.stringify(report,null,2));
console.log(JSON.stringify({
  primary_assets:report.primary.assets.length,
  primary_raw_events:report.primary.raw_event_count,
  primary_episodes:report.primary.episode_count,
  excluded:report.excluded_from_primary,
  missing:report.missing_from_run,
  seven_day:{
    pooled_episode:report.primary.pooled_episode_events["7d"],
    asset_balanced:report.primary.asset_balanced_episode_means["7d"],
    bootstrap:report.primary.bootstrap_asset_balanced_episode_mean["7d"],
    btc_adjusted:report.primary.btc_adjusted_non_btc_episode_returns["7d"]
  },
  report:`${OUT}/validation-report.json`
},null,2));
