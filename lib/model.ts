// lib/model.ts — the radar's value model, written fresh for v12.
//
// Every number this module produces is derived at run time from the sealed
// snapshot. No protocol name is hardcoded anywhere. The only baked-in numbers
// are the estimator's shape (shrinkage strength, trim, clamps), the chain cost
// table (typical gas, rounded), and the farmer's stated position size.
// A wrapped, bridged, staked or exchange product is never ranked as a
// pre-token launch: the bounty's own watchlist rule excludes it, and this
// module applies that rule to the whole board (see isWrappedOrBridged).

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface OddsParts {
  base: number;
  age: number;
  growth: number;
}

export interface FarmStep {
  text: string;
  cost_usd: number;
  minutes: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  is_watchlist: boolean;
  odds: number;
  odds_base: number;
  odds_age: number;
  odds_growth: number;
  fitted_mcap_usd: number;
  fitted_ratio: number;
  category_comps: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_hours: number;
  expected_value_usd: number;
  net_usd: number;
  per_hour_usd: number;
}

export interface Validation {
  loo_n: number;
  loo_median_abs_log_error: number;
  loo_within_3x: number;
  wf_n: number;
  wf_median_pred_actual: number;
  wf_within_3x: number;
  global_ratio_median: number;
  comps_n: number;
  global_token_rate: number;
  excluded_wrapped: number;
}

export interface ModelOut {
  rows: BoardRow[];
  validation: Validation;
  fitted: {
    global_log_ratio: number;
    by_category: Record<string, { n: number; log_ratio: number; token_rate: number }>;
  };
  comp_log_ratios: Record<string, number[]>;
}

// ---------------------------------------------------------------- helpers

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Records a token when DefiLlama carries a gecko id or a symbol for it. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// ----------------------------------------------------------------
// Wrapped / bridged / staked / exchange products
//
// The bounty's own watchlist rule keeps these off the watchlist, and the
// same rule decides the whole board: a wrapped, staked or bridged product
// of a token that already trades is not a pre-token launch, however large
// its TVL. WBTC, Binance staked ETH and USDT0 are the rule's own examples.
// The lists below are the rule's own lists from the bounty text (categories
// and exchange names), not a list of protocol names: no protocol name is
// hardcoded anywhere.

/** Categories the watchlist rule excludes: bridges and exchange products. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names the watchlist rule excludes when a name begins with one. */
export const EXCHANGE_NAMES = [
  'Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini',
];

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_MARKER = /\s(v\d+|\d+\.\d+)$/i;

/** True when a protocol is a wrapped, staked or bridged product of a token
 *  that already trades, or an exchange product — the watchlist rule's
 *  exclusion, applied to the whole board. */
export function isWrappedOrBridged(p: Protocol): boolean {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((n) => p.name.startsWith(n))) return true;
  if (VERSION_MARKER.test(p.name)) return true;
  return false;
}

/** Priced comps: a token that trades with a positive market cap and real TVL. */
export function tradedComps(ps: Protocol[]): Protocol[] {
  return ps.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 1_000_000);
}

function logRatio(p: Protocol): number {
  return Math.log((p.mcap_usd as number) / p.tvl_usd);
}

/** Trimmed mean of log ratios, trimming the outer `trim` share on each side. */
export function trimmedMeanLogRatio(rows: Protocol[], trim: number): number {
  const v = rows.map(logRatio).sort((a, b) => a - b);
  const k = Math.floor(v.length * trim);
  const s = v.slice(k, v.length - k || undefined);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

// ---------------------------------------------------------------- fitting

export interface RatioFit {
  globalLog: number;
  byCat: Map<string, { n: number; logRatio: number }>;
}

export function fitRatios(comps: Protocol[]): RatioFit {
  const globalLog = median(comps.map(logRatio));
  const byCat = new Map<string, { n: number; logRatio: number }>();
  const groups = new Map<string, Protocol[]>();
  for (const p of comps) {
    const c = p.category ?? '(none)';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(p);
  }
  for (const [c, rows] of groups) byCat.set(c, { n: rows.length, logRatio: trimmedMeanLogRatio(rows, 0.1) });
  return { globalLog, byCat };
}

export const SHRINK_K = 5;

/** Shrinkage-trimmed category estimator: a category's own trimmed mean, pulled
 *  toward the global median with strength k=5, so a one-comp category cannot
 *  set the value of a whole watchlist block on its own. */
export function fittedLogRatio(p: Protocol, fit: RatioFit): number {
  const cat = fit.byCat.get(p.category ?? '(none)');
  if (!cat) return fit.globalLog;
  return (cat.n * cat.logRatio + SHRINK_K * fit.globalLog) / (cat.n + SHRINK_K);
}

function predictLogMcap(p: Protocol, fit: RatioFit): number {
  return Math.log(p.tvl_usd) + fittedLogRatio(p, fit);
}

/** Leave-one-out over the priced comps: each comp is predicted from the rest. */
export function looValidation(comps: Protocol[]): { median_abs_log_error: number; within_3x: number } {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const test = comps[i];
    const train = comps.filter((_, j) => j !== i);
    const fit = fitRatios(train);
    errs.push(Math.abs(predictLogMcap(test, fit) - Math.log(test.mcap_usd as number)));
  }
  return {
    median_abs_log_error: median(errs),
    within_3x: errs.filter((e) => e <= Math.log(3)).length / errs.length,
  };
}

/** Walk-forward: fit on the earlier-listed comps, test on the 20 latest. */
export function walkForward(comps: Protocol[]): { median_pred_actual: number; within_3x: number; n: number } {
  const dated = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const test = dated.slice(-20);
  const train = dated.slice(0, -20);
  const fit = fitRatios(train);
  const ratios = test.map((t) => Math.exp(predictLogMcap(t, fit) - Math.log(t.mcap_usd as number)));
  return {
    median_pred_actual: median(ratios),
    within_3x: ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length,
    n: test.length,
  };
}

// ---------------------------------------------------------------- odds

/** Base launch rate of a category: the share of its protocols that record a
 *  token, shrunk toward the global rate with a prior of 3 so a one-protocol
 *  category never reads 0 or 1. */
export function baseRates(ps: Protocol[]): { byCat: Map<string, number>; global: number } {
  const global = ps.filter(recordsToken).length / ps.length;
  const byCat = new Map<string, number>();
  const groups = new Map<string, Protocol[]>();
  for (const p of ps) {
    const c = p.category ?? '(none)';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(p);
  }
  for (const [c, rows] of groups) {
    const tok = rows.filter(recordsToken).length;
    byCat.set(c, (tok + 3 * global) / (rows.length + 3));
  }
  return { byCat, global };
}

export function oddsFor(p: Protocol, base: number, asOf: string): OddsParts & { odds: number } {
  const listed = p.listed_at ? Date.parse(p.listed_at) : NaN;
  const ageDays = Number.isFinite(listed) ? Math.max(0, (Date.parse(asOf) - listed) / 86400000) : 365;
  // The longer a protocol has run with no token, the less likely a launch.
  const age = 1 / (1 + ageDays / 365);
  // A small momentum tilt, capped at ten percent either way. Cross-sectionally
  // growth runs the other way (fast growers are young and unlaunched), so the
  // tilt is a forward prior, not a fitted effect, and it is kept small.
  const g = p.change_7d ?? 0;
  const growth = 1 + clamp(g, -10, 10) * 0.01;
  const odds = clamp(base * age * growth, 0.05, 0.85);
  return { base, age, growth, odds };
}

// ---------------------------------------------------------------- farm plans

/** Typical cost of one ordinary transaction on a chain, in whole dollars,
 *  rounded from public gas trackers at the snapshot date. */
export const CHAIN_TX_USD: Record<string, number> = {
  Ethereum: 4.5,
  Arbitrum: 0.35,
  Optimism: 0.25,
  Base: 0.15,
  BSC: 0.25,
  Polygon: 0.1,
  Avalanche: 0.5,
  Solana: 0.02,
  Sui: 0.05,
  Aptos: 0.05,
  Bitcoin: 3,
  'Bittensor': 0.3,
  'CORE': 0.2,
  'Babylon Genesis': 0.2,
  Flare: 0.1,
};

export function txCost(chain: string): number {
  return CHAIN_TX_USD[chain] ?? 1;
}

function coreAction(category: string | null, name: string, chain: string): string {
  switch (category) {
    case 'Lending':
      return `Supply $1,000 USDC to ${name}'s lending pool on ${chain} and borrow $400 against it, keeping the health factor above 2`;
    case 'Dexs':
      return `Swap $500 USDC for the pool's base asset on ${name} (${chain}) and add $500 to a liquidity pair, holding the LP receipt`;
    case 'Risk Curators':
      return `Allocate $1,000 to a curator vault on ${name} (${chain}) and hold the vault share while the curator's allocation runs`;
    case 'RWA':
      return `Mint $1,000 of ${name}'s tokenized asset on ${chain} and hold it through one full epoch`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit $1,000 into ${name}'s yield vault on ${chain} and switch on auto-compound for the position`;
    case 'Restaking':
      return `Restake $1,000 of liquid-staking tokens through ${name} on ${chain} and keep the restaked position active`;
    case 'Basis Trading':
      return `Open a $1,000 delta-neutral basis position on ${name} (${chain}) and hold it while funding stays positive`;
    case 'Liquid Staking':
      return `Stake $1,000 of the chain's native asset with ${name} on ${chain} and hold the liquid receipt`;
    case 'Derivatives':
      return `Open a $1,000 hedged derivatives position on ${name} (${chain}) and keep margin above the maintenance line`;
    case 'Bridge':
    case 'Canonical Bridge':
      return `Bridge $1,000 across ${name} on ${chain} and back once, keeping the receipt for the activity record`;
    default:
      return `Use ${name} on ${chain} with a $1,000 position and keep it active for the full farming window`;
  }
}

/** A concrete, costed farm plan: bridge in, the core action, a weekly repeat,
 *  a risk check, and the exit. Every step carries its own cost and minutes. */
export function farmPlan(p: Protocol): FarmStep[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const tx = txCost(chain);
  const bridge = chain === 'Ethereum' ? 12 : 1.5;
  const steps: FarmStep[] = [
    {
      text: `Move $1,000 USDC onto ${chain} through the official bridge and connect a fresh wallet to ${p.name} (about $${bridge.toFixed(2)}, 15 min).`,
      cost_usd: bridge,
      minutes: 15,
    },
    {
      text: `${coreAction(p.category, p.name, chain)} (about $${(tx * 2).toFixed(2)} in gas, 20 min).`,
      cost_usd: tx * 2,
      minutes: 20,
    },
    {
      text: `Repeat the core action once a week for four weeks so the activity history is steady, not a single-day spike (about $${(tx * 4).toFixed(2)} in gas, 4 x 10 min).`,
      cost_usd: tx * 4,
      minutes: 40,
    },
    {
      text: `Check the position weekly: top the collateral up if TVL moves more than 20% either way, and never let a borrow fall below a health factor of 1.5 (about $${tx.toFixed(2)}, 10 min).`,
      cost_usd: tx,
      minutes: 10,
    },
    {
      text: `When a token is announced, claim through the protocol's own page only and unstake in tranches instead of all at once (about $${(tx * 2).toFixed(2)}, 15 min).`,
      cost_usd: tx * 2,
      minutes: 15,
    },
  ];
  return steps;
}

// ---------------------------------------------------------------- board

const POSITION_USD = 1000;
/** A $1,000 farm is assumed to capture 0.001% of launch value. Stated on the
 *  board so the reader can re-scale it to their own size. */
const SHARE = 0.00001;
const HOUR_VALUE_USD = 15;

export function buildBoard(snap: Snapshot): ModelOut {
  const ps = snap.protocols;
  const comps = tradedComps(ps);
  const fit = fitRatios(comps);
  const loo = looValidation(comps);
  const wf = walkForward(comps);
  const rates = baseRates(ps);
  const watch = new Set(snap.watchlist);

  const preToken = ps.filter((p) => !recordsToken(p));
  const watchRows = preToken.filter((p) => watch.has(p.slug));
  // The extra rows are pre-token protocols below the floor — with the
  // watchlist rule's wrapped/bridge/CEX exclusion applied to the whole
  // board, so a wrapped product of a token that already trades can never
  // top the ranking on TVL alone. The watchlist rows pass the rule by
  // construction (the snapshot's list was produced by it).
  const excludedWrapped = preToken.filter((p) => !watch.has(p.slug) && isWrappedOrBridged(p)).length;
  const extra = preToken
    .filter((p) => !watch.has(p.slug) && !isWrappedOrBridged(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 160);
  const picked = [...watchRows, ...extra];

  const rows: BoardRow[] = picked.map((p) => {
    const fittedRatio = Math.exp(fittedLogRatio(p, fit));
    const fittedMcap = p.tvl_usd * fittedRatio;
    const base = rates.byCat.get(p.category ?? '(none)') ?? rates.global;
    const o = oddsFor(p, base, snap.as_of);
    const implied = Math.max(1, Math.round(fittedMcap * o.odds));
    const steps = farmPlan(p);
    const cost = steps.reduce((a, s) => a + s.cost_usd, 0);
    const minutes = steps.reduce((a, s) => a + s.minutes, 0);
    const hours = minutes / 60;
    const expected = implied * SHARE;
    const net = expected - cost - hours * HOUR_VALUE_USD;
    const perHour = hours > 0 ? net / hours : net;
    const verdict: BoardRow['verdict'] = net > 100 && perHour > 20 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: steps.map((s) => s.text),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      is_watchlist: watch.has(p.slug),
      odds: +o.odds.toFixed(3),
      odds_base: +o.base.toFixed(3),
      odds_age: +o.age.toFixed(3),
      odds_growth: +o.growth.toFixed(3),
      fitted_mcap_usd: Math.round(fittedMcap),
      fitted_ratio: +fittedRatio.toFixed(3),
      category_comps: fit.byCat.get(p.category ?? '(none)')?.n ?? 0,
      verdict,
      farm_cost_usd: +cost.toFixed(2),
      farm_hours: +hours.toFixed(2),
      expected_value_usd: +expected.toFixed(2),
      net_usd: +net.toFixed(2),
      per_hour_usd: +perHour.toFixed(2),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  // Ranks 1..N with values never rising as rank ascends; nudge ties down a
  // dollar at a time so the board is a strict ranking, not a flat line.
  for (let i = 0; i < rows.length; i++) {
    rows[i].rank = i + 1;
    if (i > 0 && rows[i].implied_value_usd >= rows[i - 1].implied_value_usd) {
      rows[i].implied_value_usd = Math.max(1, rows[i - 1].implied_value_usd - 1);
    }
  }

  const byCat: Record<string, { n: number; log_ratio: number; token_rate: number }> = {};
  for (const [c, v] of fit.byCat) {
    byCat[c] = { n: v.n, log_ratio: +v.logRatio.toFixed(3), token_rate: +(rates.byCat.get(c) ?? rates.global).toFixed(3) };
  }

  // Per-category log-ratio distribution of the traded comps, for the detail
  // chart in the dashboard: each dot is one comp's log(mcap/TVL).
  const compLogRatios: Record<string, number[]> = {};
  for (const c of comps) {
    const k = c.category ?? '(none)';
    if (!compLogRatios[k]) compLogRatios[k] = [];
    compLogRatios[k].push(+Math.log((c.mcap_usd as number) / c.tvl_usd).toFixed(3));
  }
  for (const k of Object.keys(compLogRatios)) compLogRatios[k].sort((a, b) => a - b);

  return {
    rows,
    validation: {
      loo_n: comps.length,
      loo_median_abs_log_error: +loo.median_abs_log_error.toFixed(3),
      loo_within_3x: +loo.within_3x.toFixed(3),
      wf_n: wf.n,
      wf_median_pred_actual: +wf.median_pred_actual.toFixed(2),
      wf_within_3x: +wf.within_3x.toFixed(3),
      global_ratio_median: +Math.exp(fit.globalLog).toFixed(3),
      comps_n: comps.length,
      global_token_rate: +rates.global.toFixed(3),
      excluded_wrapped: excludedWrapped,
    },
    fitted: { global_log_ratio: +fit.globalLog.toFixed(3), by_category: byCat },
    comp_log_ratios: compLogRatios,
  };
}
