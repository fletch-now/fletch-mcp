#!/usr/bin/env node
// Fletch's registry as MCP tools. A thin client of the public API at
// fletch.now: every tool is one GET, cached by ETag so a repeated question
// costs a 304. Nothing here is computed locally; the numbers are the ones the
// registry daemon read, with the instant each reading was taken.
//
// Run: npx -y github:fletch-now/fletch-mcp   (stdio; set FLETCH_API_URL to point elsewhere)

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const { version: VERSION } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const USER_AGENT = `fletch-mcp/${VERSION} (+https://fletch.now)`;

const BASE = (process.env.FLETCH_API_URL ?? "https://fletch.now").replace(/\/$/, "");
const CHAIN_ID = 4663;
const API_KEY = process.env.FLETCH_API_KEY ?? "";

// The key is an account credential, and the only tool that reads account data
// is webhooks. Registry reads are public, so the key never travels with them,
// and it never travels in clear text at all.
const KEYED_PATH = "/api/v1/webhooks";
const BASE_IS_HTTPS = BASE.startsWith("https://");

function bearerFor(path) {
  if (!API_KEY || path !== KEYED_PATH) {
    return null;
  }
  if (!BASE_IS_HTTPS) {
    throw new Error("FLETCH_API_KEY is only sent over https; configure a trusted HTTPS API base.");
  }
  return `Bearer ${API_KEY}`;
}

// One entry per URL, bounded in count and in age. A long session asking about
// many tickers would otherwise keep every body it ever saw, and a stale entry
// costs a 304 round trip for nothing once the registry has rewritten the row.
const CACHE_MAX_ENTRIES = 200;
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheGet(url) {
  const entry = cache.get(url);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.storedAt > CACHE_MAX_AGE_MS) {
    cache.delete(url);
    return null;
  }
  return entry;
}

function cacheSet(url, etag, body) {
  cache.delete(url);
  cache.set(url, { etag, body, storedAt: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function redact(text) {
  return API_KEY ? text.split(API_KEY).join("[redacted]") : text;
}

async function fetchRead(url, headers) {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: "error" });
  } catch {
    throw new Error("Could not read the Fletch API: network failure, timeout or refused redirect.");
  }
}

async function readBody(response, path) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    let hint = "Check the requested route and try again.";
    if (response.status === 401) hint = "Check whether this route needs a valid API key.";
    if (response.status === 403) hint = "Check the API key's required scope and account access.";
    if (response.status === 429) hint = "Rate limit reached; wait before retrying.";
    throw new Error(redact(`HTTP ${response.status} from ${path}. ${hint}`));
  }
  try {
    return await response.text();
  } catch {
    throw new Error("The Fletch response could not be read completely. Try again.");
  }
}

async function get(path) {
  const url = `${BASE}${path}`;
  const cached = cacheGet(url);
  const headers = { accept: "application/json", "user-agent": USER_AGENT };
  if (cached) headers["if-none-match"] = cached.etag;
  const bearer = bearerFor(path);
  if (bearer) headers.authorization = bearer;
  const response = await fetchRead(url, headers);
  if (response.status === 304 && cached) {
    cacheSet(url, cached.etag, cached.body);
    return cached.body;
  }
  const raw = await readBody(response, path);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(redact(`HTTP ${response.status} from ${path} was not JSON.`));
  }
  const etag = response.headers.get("etag");
  if (etag) cacheSet(url, etag, body);
  return body;
}

function text(value) {
  return { content: [{ type: "text", text: redact(JSON.stringify(value, null, 2)) }] };
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function getText(uri) {
  const response = await fetchRead(uri.href, { "user-agent": USER_AGENT });
  return redact(await readBody(response, uri.pathname));
}

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const server = new McpServer({ name: "fletch-registry", version: VERSION });

const MARKET_FILTER_CATALOG = JSON.parse(readFileSync(new URL("./generated/market-filters.json", import.meta.url), "utf8"));
const marketInput = Object.fromEntries(Object.entries(MARKET_FILTER_CATALOG.filters).map(function schema([key, filter]) {
  return [key, z.enum(filter.options.map(function value(option) { return option.value; })).optional().describe(filter.label)];
}));
server.registerTool("filter_catalog", {
  title: "Market filter catalog",
  description: "Read current market filter values, labels, thresholds and presets shared with the Markets page. Combine filters with AND; unavailable readings cannot satisfy numeric thresholds.",
  annotations: READ_ANNOTATIONS,
  inputSchema: {},
}, async function catalog() { return text(await get(`/api/v1/chains/${CHAIN_ID}/markets/filters`)); });
server.registerTool("token_markets", {
  title: "Token markets",
  description: "Read one bounded page of issuer-listed and priority community contracts, default 25 rows. Each metric carries observation.sourceId, blockNumber/hash, sourceAt, fetchedAt, expiresAt, method, parameters, inputs, coverage, status and readStatus. Compare expiresAt with the current time; retained values may coexist with failed refreshes. Market cap expires with its earliest required input. Selection has selectedAt, expiresAt and a versioned policy; economic dominance does not verify identity. Use filter_catalog for combinations. V3 quote holdings and V4 1% depth remain separate.",
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    ...marketInput,
    q: z.string().optional().describe("Name, symbol or exact contract address"),
    page: z.number().int().min(1).optional(),
    pageSize: z.union([z.literal(25), z.literal(50)]).optional(),
    minVolumeUsd: z.number().min(MARKET_FILTER_CATALOG.minVolumeUsd.minimum).max(MARKET_FILTER_CATALOG.minVolumeUsd.maximum).optional(),
  },
}, async function markets(params) { return text(await get(`/api/v1/chains/${CHAIN_ID}/markets${query(params)}`)); });

server.registerTool(
  "status",
  {
    title: "Registry freshness",
    description:
      "Freshness of everything Fletch publishes: the daemon's heartbeat, each of the registry's jobs against the cadence it should run at (verdict fresh, late, failing, filling, stalled or never; a figure can also be unread), the scanners still reading chain history with how long they have left, and the age of every figure. Call this before trusting a number whose freshness matters. A live verdict means jobs ran on schedule, not that all rows or figures are current. metadataBacklog records due, visibleDue and neverRead counts at measuredAt. Each job metricCoverage records eligible, current, failed, unread and oldestInputAgeSeconds at measuredAt; current and failed can overlap after an unsuccessful refresh. Null coverage means unmeasured. Compare per-field observation times and coverage; a 'filling' job means its figures are partial, not wrong, and 'stalled' means a scanner's checkpoint has stopped moving, not that it is slow.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {},
  },
  async () => text(await get("/api/v1/status")),
);

server.registerTool(
  "list_assets",
  {
    title: "List registry assets",
    description:
      "Listed assets with their own trust verdicts on Robinhood Chain (chain 4663): Stock Tokens, bridged coins, USDG, WETH, each with its contract address, decimals, trust and observed state (multiplier, pauses, Chainlink price, holders, second-source agreement). Filter with q (symbol or name substring) or symbols (comma-separated exact tickers). fields adds lookalikes, corporateActions, multiplierHistory, feedRounds or concentration per asset, for up to 50 assets — concentration answers which Stock Tokens have the least float in one request.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      q: z.string().optional().describe("Symbol or name substring"),
      symbols: z.string().optional().describe("Comma-separated tickers, e.g. TSLA,AAPL"),
      fields: z.string().optional().describe("Comma-separated extras: lookalikes,corporateActions,multiplierHistory,feedRounds,concentration"),
    },
  },
  async ({ q, symbols, fields }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets${query({ q, symbols, fields })}`)),
);

server.registerTool(
  "get_asset",
  {
    title: "Get one asset by ticker",
    description:
      "One asset with everything the registry knows: address, trust, live state, multiplier history, mints and burns, daily supply reconciliation, corporate actions, the issuer's control-plane events touching it, lookalike tokens that borrow its ticker, and the last 30 Chainlink rounds. Use this before writing any address into code. state.dex identifies the pool used for the DEX price and premium: venue names the DEX, and poolId is a 32-byte v4 pool id or a 20-byte v3 pool address. V3 depth uses observed quote-side holdings; V4 depth is a bounded quote estimate for a 1% price move. These measures are distinct and are not TVL. Use the pools tool for venue and observation details.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().describe("Ticker, e.g. TSLA") },
  },
  async ({ symbol }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}`)),
);

server.registerTool(
  "get_token",
  {
    title: "Resolve a token address",
    description: "Resolve one mainnet token address through the public registry. Return its actual trust, provenance and metadata; a ticker or matching beacon dependency cannot establish issuer origin. Community requires readable metadata and bytecode evidence, and unknown fields remain null. The API may refresh missing or older-than-five-minute metadata with bounded contract reads. This does not submit a transaction or add a watcher.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("20-byte EVM token address on chain 4663") },
  },
  async ({ address }) => text(await get(`/api/v1/tokens/${encodeURIComponent(address)}`)),
);

server.registerTool(
  "search_pools",
  {
    title: "Search listed and community pools",
    description: "Read one bounded page of mainnet pools, default 20 rows ordered by volume with depth and swaps as fallbacks. Filter rather than loading the whole registry into context. stateCurrent requires a state observation within three minutes and a current independently observed quote conversion when recorded; stale, future or unread state has null current price/depth/valuations and pricePublished=false. Missing values are unknown, never zero. Published swaps24h/volumeUsd24h require complete current rolling 24-hour coverage for the selected pool. Inspect the recorded valuation method and historical quote inputs; USDG uses a nominal dollar assumption and WETH uses an explicitly estimated historical oracle conversion. Discovery and token trust remain independent of liquidity.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      q: z.string().max(256).optional().describe("Name, symbol, full token address or pool address search"),
      kind: z.enum(["all", "listed", "community", "lookalike"]).optional(),
      tier: z.enum(["active", "quiet", "dormant", "all"]).optional(),
      sort: z.enum(["volume", "traction", "depth", "swaps", "newest"]).optional(),
      venue: z.enum(["uniswap_v4", "uniswap_v3"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
  },
  async ({ q, kind, tier, sort, venue, limit, offset }) => text(await get(`/api/v1/chains/${CHAIN_ID}/dex/pools${query({ q, kind, tier, sort: sort ?? "volume", venue, limit: limit ?? 20, offset })}`)),
);

server.registerTool(
  "history",
  {
    title: "What every number for one asset was on a past day",
    description:
      "A daily snapshot per asset: multiplier, pause and trading-halt flags, Chainlink price and staleness, bid and ask, divergence, DEX price, premium and liquidity, total supply, holders and the lookalike count, one row per UTC day. Use at=YYYY-MM-DD to answer 'what was TSLA's premium on that day'; from/to or days set a window (default the last 90). fields narrows each row. coverage says how many days are on record: history begins the day the daily snapshot first ran and there is nothing before it, and a null is a figure that was not read that day rather than a zero. Each row is a single reading taken at takenAt, not a daily open, close or average: the job runs hourly and rewrites the current day's row, so today's row is a partial day. Compare takenAt across rows before treating the series as evenly spaced. Prices are USD numbers; dexPremiumPct is a percent, how far the deepest pool in dollars of any DEX read sat above (+) or below (-) the Chainlink feed price that day (the pools tool names that pool's venue; dexLiquidity is Uniswap's raw L, comparable only between pools of the same pair); totalSupplyRaw is a string in the token's own decimals (the response carries decimals); day is a UTC day and takenAt the ISO instant the reading was taken. The Chainlink price already includes the ERC-8056 multiplier, the bid and ask do not.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      symbol: z.string().describe("Ticker, e.g. TSLA"),
      at: z.string().optional().describe("One UTC day, YYYY-MM-DD"),
      from: z.string().optional().describe("First UTC day, YYYY-MM-DD"),
      to: z.string().optional().describe("Last UTC day, YYYY-MM-DD"),
      days: z.number().int().min(1).max(3650).optional(),
      fields: z.string().optional().describe("Comma-separated keys, e.g. feedPrice,dexPremiumPct"),
    },
  },
  async ({ symbol, at, from, to, days, fields }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}/history${query({ at, from, to, days, fields })}`)),
);

server.registerTool(
  "feed_rounds",
  {
    title: "Chainlink round history for one asset",
    description: "The Chainlink feed's rounds for a ticker, newest first: roundId, answer (price × multiplier, USD), startedAt, updatedAt. since narrows to rounds after an ISO instant; limit up to 2000.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      symbol: z.string().describe("Ticker, e.g. TSLA"),
      since: z.string().optional().describe("ISO 8601 instant"),
      limit: z.number().int().min(1).max(2000).optional(),
    },
  },
  async ({ symbol, since, limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}/feed/rounds${query({ since, limit })}`)),
);

server.registerTool(
  "holders",
  {
    title: "Holders, labels and where the float sits for one asset",
    description:
      "How much of a ticker is in investors' hands and how much is parked elsewhere, plus who holds it, largest first. sits is always one of float, pools, issuer, bridge, contracts, unknown and names the concentration share that address's balance counts towards; unknown means the code probe has not checked the address yet. label and labelKind are null for an address the registry has nothing to say about. rawBalance is in base units; divide by 10^decimals. sharePct is that balance over the live totalSupplyRaw, while the concentration shares are over the balances the ledger held at concentration.asOfBlock, so the two can differ slightly. concentration carries top 1, top 10, Gini and the six shares that say where the supply sits — floatPct (in ordinary wallets), poolsPct, issuerPct, bridgePct, contractsPct, unknownPct — which add to 100. unknownPct is the share held by addresses the probe has not checked — it checks every holder above a ten-thousandth of a token's supply, so a long tail of small holdings stays there and floatPct is always a floor. issuerPct covers wallets labelled issuer, written only for Stock Tokens; issuerAddress is this asset's largest mint recipient whatever the asset type. concentration.day is the UTC day of the reading, takenAt when the job wrote it, and the job runs every 24 h; concentration.holders is the count at that moment while holderCount is a separately timed observation. concentration is null until the transfer ledger has reached the chain head; progress says whether it has.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().describe("Ticker, e.g. TSLA"), limit: z.number().int().min(1).max(500).optional() },
  },
  async ({ symbol, limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}/holders${query({ limit })}`)),
);

server.registerTool(
  "activity",
  {
    title: "Daily activity for one asset",
    description: "Transfers as economics per UTC day: transfers, volume (raw units), mints, burns, transfers settled against USDG in the same transaction, transfers outside US market hours.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().describe("Ticker, e.g. TSLA"), days: z.number().int().min(1).max(400).optional() },
  },
  async ({ symbol, days }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}/activity${query({ days })}`)),
);

server.registerTool(
  "pools",
  {
    title: "DEX pools for one asset",
    description:
      "Pools trading a ticker on Uniswap v3 and v4, ordered by the endpoint's depthUsd field. V3 depth is observed quote-side holdings; V4 depth is a bounded quote estimate for a 1% price move. Raw liquidity L is not dollars. The best pool supplies the asset's premium to its feed. Swap counts and volume require a complete rolling 24-hour window ending at metricsAsOf; an end older than 120 seconds yields null. volumeValuation distinguishes nominal USDG denomination from recorded historical WETH oracle estimates. Keep source ages, coverage reasons and nulls. stateCurrent requires a valid state observation within three minutes and a current independently observed quote conversion when recorded. A v4 pool has a pool id within PoolManager; a v3 pool has a contract address. Discovery reports each venue's scan progress; unscanned history can contain pools absent from this list.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().describe("Ticker, e.g. TSLA") },
  },
  async ({ symbol }) => text(await get(`/api/v1/chains/${CHAIN_ID}/assets/${encodeURIComponent(symbol)}/pools`)),
);

server.registerTool(
  "dex_venues",
  {
    title: "What each DEX venue contributes chain-wide",
    description:
      "One row per tracked DEX venue, including venues with no recorded pools: pool counts, priced pools, assets priced there and discovery progress. Venue depthUsd sums quote-side holdings for v3 or bounded 1% quote estimates for v4. Keep the two measures separate; neither is TVL. Swap and volume fields require complete current rolling 24-hour coverage. Volume valuation distinguishes nominal USDG from historical WETH oracle estimates. checkedAt records pool-state observation time; discovery.headAt records the observed chain head. Counts remain partial while readingHistory is true. Pons launchpad pools created through the Uniswap v3 factory count under uniswap_v3.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {},
  },
  async () => text(await get(`/api/v1/chains/${CHAIN_ID}/dex`)),
);

server.registerTool(
  "bridge",
  {
    title: "Token bridge: escrow, flows, claimable withdrawals",
    description: "Each bridged asset's L1 escrow against its L2 supply (the gap is value in flight), the latest deposits and withdrawals seen on L2, and withdrawals whose seven-day window has passed. symbol narrows the flows.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
  },
  async ({ symbol, limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/bridge${query({ symbol, limit })}`)),
);

server.registerTool(
  "issuer_documents",
  {
    title: "The issuer's paperwork",
    description: "Every document the issuer publishes (base prospectus, supplements, notices, one Final Terms PDF per ticker) with its CDN ETag and Last-Modified and the token it maps to, plus the watched pages (restricted jurisdictions, corporate actions, upgrade notices) and when their text last changed. kind filters: base_prospectus, supplement, notice, final_terms, other.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { kind: z.enum(["base_prospectus", "supplement", "notice", "final_terms", "other"]).optional() },
  },
  async ({ kind }) => text(await get(`/api/v1/chains/${CHAIN_ID}/issuer${query({ kind })}`)),
);

server.registerTool(
  "lookalikes",
  {
    title: "Lookalike tokens",
    description:
      "ERC-20s on Robinhood Chain that borrow a listed ticker or exact name at another address, most held first, with the recorded collision verdict and evidence. A matching beacon is a dependency observation and does not establish issuer deployment; legacy unlisted_stock records are returned as unverified. Official listing or separately verified deployment evidence is required for issuer origin. Filter by symbol.",
    annotations: READ_ANNOTATIONS,
    inputSchema: { symbol: z.string().optional().describe("Ticker, e.g. TSLA"), limit: z.number().int().min(1).max(1000).optional() },
  },
  async ({ symbol, limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/lookalikes${query({ symbol, limit })}`)),
);

server.registerTool(
  "control_plane",
  {
    title: "The issuer's registry contract",
    description: "The AccessControlsRegistry that is beacon, global pause, blocklist and role registry for every Stock Token: paused, implementation, blocked-address count, and its latest events (Blocked, Unblocked, Paused, Upgraded, roles).",
    annotations: READ_ANNOTATIONS,
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  },
  async ({ limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/control-plane${query({ limit })}`)),
);

server.registerTool(
  "chain_health",
  {
    title: "Chain vital signs",
    description: "Robinhood Chain's latest reading: head block, block time, base fee, L1 block, batch count, delayed messages, batch-poster balance, status page.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {},
  },
  async () => text(await get(`/api/v1/chains/${CHAIN_ID}/health`)),
);

server.registerTool(
  "events",
  {
    title: "Registry changelog",
    description:
      "Authority events: a token paused or halted, an address blocked, a multiplier scheduled or applied, a feed gone stale, a supply residual, a listing, a lookalike, chain status. Without since, kind filters exactly or by prefix and symbol narrows the recent newest-first page. With since, the API returns the full newer sequence oldest first: apply kind/symbol filters client-side and retain nextCursor after processing the batch. Deduplicate by stable id. observedAt is recording time; occurredAt is not always block time and block/txHash may be null. A lookalike event indicates a label collision, not intent; no rows does not prove that nothing happened.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {
      kind: z.string().optional(),
      symbol: z.string().optional(),
      since: z.string().optional().describe("ISO 8601 instant, or the previous nextCursor"),
      limit: z.number().int().min(1).max(500).optional(),
    },
  },
  async ({ kind, symbol, since, limit }) => text(await get(`/api/v1/chains/${CHAIN_ID}/events${query({ kind, symbol, since, limit })}`)),
);

server.registerTool(
  "corporate_actions",
  {
    title: "Corporate actions in progress",
    description: "Dividends, splits and other corporate actions Robinhood has published for Stock Tokens, each tied to its token.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {},
  },
  async () => text(await get(`/api/v1/chains/${CHAIN_ID}/corporate-actions`)),
);

server.registerTool(
  "webhooks",
  {
    title: "Your webhook endpoints for watcher alerts",
    description:
      "The HTTPS endpoints this account has registered for watcher alerts, with when each last received a delivery and its last error. Needs FLETCH_API_KEY with the watchers:read scope; without a key this returns 401. The key is sent only to this route, and only when FLETCH_API_URL is https. Creating, rotating and deleting an endpoint is deliberately not exposed here — an endpoint is where alerts leave Fletch, so it is added in the dashboard (Settings → Webhooks) or with an explicit POST /api/v1/webhooks. Each delivery is signed X-Fletch-Signature: t=<unix>,v1=<hex hmac-sha256 over \"<t>.<body>\">. lastError is the most recent failure whenever it happened and is cleared by the next success — it is not evidence the endpoint is down now; compare lastErrorAt with lastDeliveredAt, which counts test pings as well as alerts.",
    annotations: READ_ANNOTATIONS,
    inputSchema: {},
  },
  async () => text(await get(KEYED_PATH)),
);

server.registerResource("llms-txt", `${BASE}/llms.txt`, { title: "Fletch for agents", description: "What Fletch is and how to use its registry, in plain text.", mimeType: "text/plain" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/plain", text: await getText(uri) }],
}));

server.registerResource("openapi", `${BASE}/api/v1/openapi.json`, { title: "Fletch API, OpenAPI 3", mimeType: "application/json" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: await getText(uri) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
