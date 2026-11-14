// Token Launch Radar — token-radar-01 entry.
//
// Reads a sealed DefiLlama snapshot, ranks the protocols that record no
// token by an implied value derived from the snapshot itself, and writes
// a board, a dashboard data file, and a dossier for the judge.
// Node 22, standard library only. Deterministic: no clock, no randomness,
// no network.

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

type Proto = {
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
};

type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
};

type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  base_value_usd: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
};

const BLOCKED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_PREFIXES = [
  "binance",
  "coinbase",
  "bybit",
  "kraken",
  "bitget",
  "okx",
  "bitfinex",
  "gemini",
];

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function fail(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): { input: string | null; output: string | null } {
  let input: string | null = null;
  let output: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (argv[i].startsWith("--input=")) input = argv[i].slice("--input=".length);
    else if (argv[i].startsWith("--output=")) output = argv[i].slice("--output=".length);
  }
  return { input, output };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function recordsNoToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function eligible(p: Proto): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && BLOCKED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const lower = p.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return true;
}

// Typical gas for one simple transaction on each chain, in whole dollars.
// Used only to put a concrete cost figure in the farm steps.
const GAS_USD: Record<string, number> = {
  Ethereum: 4,
  Base: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.05,
  Solana: 0.01,
  BSC: 0.15,
  Polygon: 0.05,
  Avalanche: 0.2,
  Unichain: 0.05,
  Hyperliquid: 0.01,
  Berachain: 0.1,
  Sui: 0.01,
  Aptos: 0.01,
  Linea: 0.05,
  Scroll: 0.05,
  zkSync: 0.1,
  Blast: 0.05,
  Mantle: 0.05,
  Gnosis: 0.05,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function money(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

// The one on-chain move that puts capital to work, shaped by category.
function coreAction(p: Proto, chain: string, gas: number): string {
  const name = p.name;
  const cat = p.category ?? "";
  if (cat === "Lending" || cat === "CDP" || cat === "Uncollateralized Lending" || cat === "Collateral Management" || cat === "CDP Manager") {
    return `Supply $50 to $200 of collateral into ${name} on ${chain}, then borrow a small amount against it and keep the health factor above 1.5; gas is about ${money(gas)} and the deposit takes around 10 minutes.`;
  }
  if (cat === "Dexs") {
    return `Swap $50 to $200 through ${name} on ${chain}, then add liquidity to its main pool with half the proceeds; gas is about ${money(gas)} per step and the whole round takes around 15 minutes.`;
  }
  if (cat === "Yield" || cat === "Yield Aggregator" || cat === "Risk Curators" || cat === "Onchain Capital Allocator" || cat === "Farm" || cat === "Leveraged Farming" || cat === "Liquidity Manager") {
    return `Deposit $50 to $200 into the main ${name} vault on ${chain} and hold the receipt token it issues; gas is about ${money(gas)} and the deposit takes around 10 minutes.`;
  }
  if (cat === "RWA") {
    return `Buy or mint $50 to $200 of the tokenized asset ${name} offers on ${chain}; gas is about ${money(gas)} and the purchase takes around 10 minutes.`;
  }
  if (cat === "Restaking" || cat === "Staking Pool") {
    return `Stake $50 to $200 of the supported asset through the ${name} pool on ${chain}; gas is about ${money(gas)} and the stake takes around 10 minutes.`;
  }
  if (cat === "Prediction Market") {
    return `Place a $10 to $50 position on one ${name} market on ${chain} and let it settle; gas is about ${money(gas)} and placing it takes around 5 minutes.`;
  }
  if (cat === "Payments" || cat === "Stablecoin Wrapper" || cat === "Insurance" || cat === "Governance Incentives") {
    return `Use the ${name} product on ${chain} with $50 to $200 — pay, wrap, insure or vote, whichever it offers — and keep the confirmation; gas is about ${money(gas)} and it takes around 10 minutes.`;
  }
  if (cat === "Chain") {
    return `Bridge $50 to $200 onto ${chain} and use the flagship ${name} app there with a real transaction; bridging costs a few dollars and takes around 20 minutes.`;
  }
  return `Deposit $50 to $200 into the main ${name} pool on ${chain} and hold the position receipt; gas is about ${money(gas)} and the deposit takes around 10 minutes.`;
}

function farmSteps(p: Proto): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const gas = gasFor(chain);
  const steps = [
    `Open a fresh wallet on ${chain} and fund it with about $60 for gas plus your first ${p.name} position; write the seed phrase on paper, keep it offline, and never share it. Takes about 10 minutes.`,
    coreAction(p, chain, gas),
    `Repeat the same ${p.name} action once a week for the next month, adding $25 to $100 each time, so the position shows steady use rather than a single deposit; each round costs about ${money(gas)} in gas.`,
    `Check your position on the ${p.name} dashboard or points page every week and save each transaction hash plus a dated note of the balance; a short weekly record takes about 5 minutes.`,
    `When you unwind, withdraw from ${p.name} in two or three steps over a few days and leave about $5 on ${chain} for exit gas; use only the separate wallet you farmed with. Takes about 15 minutes.`,
  ];
  return steps.map((s) => {
    const t = s.trim().replace(/\s+/g, " ");
    return t.length > 600 ? `${t.slice(0, 597).trimEnd()}...` : t;
  });
}

function computeBoard(snap: Snapshot): { rows: BoardRow[]; medianMultiple: number; live: { slug: string; name: string; tvl_usd: number; mcap_usd: number | null }[] } {
  const ratios = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const medianMultiple = median(ratios);
  const watch = new Set(snap.watchlist);

  const rows: BoardRow[] = snap.protocols
    .filter(eligible)
    .map((p) => {
      const base = p.tvl_usd * medianMultiple;
      const growth = p.change_7d === null ? 1 : 1 + clamp(p.change_7d / 100, -0.4, 0.8);
      const ageDays = p.listed_at === null ? null : daysBetween(p.listed_at, snap.as_of);
      const maturity = ageDays === null ? 0.85 : 0.7 + 0.3 * (1 - Math.exp(-ageDays / 365));
      const breadth = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 5);
      const implied = Math.round(clamp(base * growth * maturity * breadth, 1, 1e14));
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: implied,
        farm_steps: farmSteps(p),
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: ageDays,
        watchlist: watch.has(p.slug),
        base_value_usd: Math.round(base),
        growth_factor: growth,
        maturity_factor: maturity,
        breadth_factor: breadth,
      };
    })
    .sort((a, b) => {
      if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });

  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const live = snap.protocols
    .filter((p) => !recordsNoToken(p))
    .map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));

  return { rows, medianMultiple, live };
}

function selfCheck(rows: BoardRow[], snap: Snapshot, shotsDir: string): string[] {
  const problems: string[] = [];
  if (rows.length < 100) problems.push(`board has ${rows.length} rows, fewer than 100`);
  const seen = new Set<string>();
  for (const slug of snap.watchlist) {
    if (!rows.some((r) => r.slug === slug)) problems.push(`watchlist slug missing from board: ${slug}`);
  }
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) problems.push(`row ${r.slug} has rank ${r.rank}, expected ${i + 1}`);
    if (seen.has(r.slug)) problems.push(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
  });
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      problems.push(`implied value rises at rank ${rows[i].rank}`);
      break;
    }
  }
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd)) {
    problems.push("all implied values are equal");
  }
  for (const r of rows) {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      problems.push(`row ${r.slug} has ${r.farm_steps.length} farm steps`);
      break;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) {
        problems.push(`row ${r.slug} has a farm step of ${t.length} chars`);
        break;
      }
    }
  }
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => statSync(join(shotsDir, f)).isFile())
    : [];
  if (shots.length < 3) problems.push(`only ${shots.length} screenshots, need at least 3`);
  return problems;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

  let inputPath = args.input ?? "/input/snapshot.json";
  if (existsSync(inputPath) && statSync(inputPath).isDirectory()) {
    inputPath = join(inputPath, "snapshot.json");
  }
  if (!existsSync(inputPath)) {
    fail(`snapshot not found: ${inputPath}`, 2);
  }

  let snap: Snapshot;
  try {
    snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  } catch (e) {
    fail(`cannot parse snapshot: ${e instanceof Error ? e.message : String(e)}`, 2);
  }
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    fail("snapshot is missing protocols or watchlist", 2);
  }

  const { rows, medianMultiple, live } = computeBoard(snap);

  const shotsDir = join(HERE, "screenshots");
  const problems = selfCheck(rows, snap, shotsDir);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`token-radar self-check: ${p}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(join(outDir, "board.json"), `${JSON.stringify({ rows }, null, 2)}\n`, "utf8");

  const payload = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    median_multiple: medianMultiple,
    board_size: rows.length,
    watchlist_covered: snap.watchlist.length,
    rows,
    live,
  };
  const dataJs = `window.RADAR = ${JSON.stringify(payload)};\n`;
  writeFileSync(join(outDir, "data.js"), dataJs, "utf8");

  cpSync(join(HERE, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  cpSync(join(HERE, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  process.stdout.write(
    `token-radar: ${snap.protocols.length} protocols, watchlist ${snap.watchlist.length}, ` +
      `board ${rows.length} rows, top implied value $${rows[0].implied_value_usd.toLocaleString("en-US")} ` +
      `(${rows[0].name}), median multiple ${medianMultiple.toFixed(4)}\n`,
  );
}

main();
