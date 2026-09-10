<p align="center"><img src="https://raw.githubusercontent.com/fletch-now/fletch-mcp/main/docs/fletch-logo.png" width="160" alt="Fletch"></p>

# fletch-mcp

Fletch's Robinhood Chain registry as [MCP](https://modelcontextprotocol.io) tools: verified
Stock Token addresses, live state (multiplier, pauses, Chainlink price, holders), round
history, lookalike tokens, the issuer's control plane, chain health and the changelog.
A thin client of the public API at https://fletch.now; registry reads need no key.

```
npx -y github:fletch-now/fletch-mcp
```

Runs straight from this repository; the npm package `fletch-mcp` follows, and the
command becomes `npx -y fletch-mcp` when it does.

[fletch.now/developers](https://fletch.now/developers) ·
[API reference](https://fletch.now/api/v1/docs) ·
[Registry](https://fletch.now/registry) ·
[llms.txt](https://fletch.now/llms.txt)

## Use

Claude Desktop, Claude Code, Cursor and any other MCP client take a stdio server:

```json
{
  "mcpServers": {
    "fletch": { "command": "npx", "args": ["-y", "github:fletch-now/fletch-mcp"] }
  }
}
```

Claude Code: `claude mcp add fletch -- npx -y github:fletch-now/fletch-mcp`.

## Environment

- `FLETCH_API_URL`: where the API lives. Default `https://fletch.now`.
- `FLETCH_API_KEY`: optional. Needed only by `webhooks`, which reads one account's own
  endpoints. The key is sent to `/api/v1/webhooks` and to no other route, and never over
  plain http; with an `http://` base the `webhooks` tool returns an error instead.
  Redirects are refused, including same-origin redirects. Failure messages omit
  upstream bodies and configured keys; successful text also redacts the configured
  key if an upstream happens to echo it. Configure only a trusted API base.

Rate limits are the API's: anonymous callers get 120 requests a minute per address, and
a key has its own budget of 600 requests an hour. Every tool result is cached by ETag, so
repeating a question costs a conditional request that usually answers 304. The cache
keeps at most 200 entries for at most ten minutes each.

## Tools

| Tool | Reads |
|---|---|
| `status` | is the registry live: jobs, figures, ages, verdicts |
| `list_assets` | every asset with state; `q`, `symbols`, `fields` (lookalikes, corporateActions, multiplierHistory, feedRounds, concentration) |
| `get_asset` | one ticker with history, lookalikes and last rounds |
| `history` | one row per UTC day of every per-asset number, each row one reading rather than a close; `at`, `from`, `to`, `days`, `fields` |
| `feed_rounds` | Chainlink rounds for a ticker, `since`, `limit` |
| `holders` | how much of a token is in investors' hands: the six shares (float, pools, issuer, bridge, contracts, unchecked, which add to 100), holders with share and address labels, ledger progress. Float is a floor: the probe checks holders above a ten-thousandth of supply |
| `activity` | daily transfers, volume, DvP, off-hours |
| `get_token` | resolve one exact mainnet address, retaining trust, metadata nulls and provenance |
| `filter_catalog` | current market filter values, thresholds, labels and presets from the public API |
| `token_markets` | paginated token contracts with combined filters, selected-pool readings, trust and source times; 25 or 50 rows |
| `search_pools` | one filtered pool page, 20 rows by default, ordered by volume; no automatic full-registry load |
| `pools` | pools trading one ticker on every DEX read (Uniswap v4 and v3), deepest first: venue, price, `depthUsd` (V3 quote holdings or V4 bounded 1% quote estimate), raw liquidity L, premium to feed, and how far each venue's scan has read |
| `dex_venues` | tracked venues: pools, dollar-priced pools, distinct V3 quote holdings or V4 bounded 1% estimates, swaps and volume, assets priced there, and whether each venue has been read at all |
| `bridge` | L1 escrow vs L2 supply, deposits, withdrawals |
| `issuer_documents` | prospectus, Final Terms per ticker, watched pages |
| `lookalikes` | tokens borrowing a listed ticker, with verdicts |
| `control_plane` | the issuer's registry contract and its events |
| `chain_health` | head, block time, batches, status |
| `events` | the changelog, filterable, with a cursor |
| `corporate_actions` | dividends and splits in progress |
| `webhooks` | your registered alert endpoints (needs `FLETCH_API_KEY`) |

Resources: `llms.txt` and the OpenAPI document.

Answers that read live state carry the instant the registry daemon took the reading
(`checkedAt`, `takenAt` or `stateCheckedAt`); `events` rows carry `occurredAt` and
`observedAt`; `corporate_actions` carries Robinhood's `processDate` only; `webhooks` reads
account data rather than daemon output. Amounts in raw units are strings; prices and
multipliers are numbers.

## What the server covers

The tools read Robinhood Chain mainnet (chain 4663) only, and they cover the registry
routes plus the webhook list. The API has more than this server exposes: `/chains`, the
watcher routes, the event stream at `/api/v1/chains/4663/events/stream`, and the build and project routes
are reachable over HTTPS as documented at
[fletch.now/api/v1/docs](https://fletch.now/api/v1/docs) but have no tool here.

`docs/` holds dated copies of `llms.txt` and `openapi.json` as served the day this
version was cut, which was before the package reached npm, so the `llms.txt` copy still
calls the MCP server unpublished. The live documents at https://fletch.now/llms.txt and
https://fletch.now/api/v1/openapi.json are the ones to trust.

## Development

```
npm ci
npm test
```

The test starts `index.mjs` over stdio with the SDK's own client, checks the tool and
resource counts, replays the ETag and bearer rules against local http and https servers,
and calls `status` against https://fletch.now. CI runs the same test on Node 20, 22 and 24.
The https server uses the self-signed pair under `test/fixtures/`, which guards nothing
outside that test.

## Licence

MIT. Fletch is not affiliated with Robinhood Markets, Inc.

## Current data and snapshots

The tools read the deployed API; status timeliness does not mean all figures are
fresh. Inspect `metadataBacklog`, coverage and each observation timestamp.
`stateCurrent=false` means current pool price, depth, valuations and changes are
unpublished; preserve their nulls. A ticker or lookalike match does not verify an
address. Pool swap fields require a complete current rolling 24-hour window.
`volumeValuation` distinguishes nominal USDG denomination from historical WETH
oracle estimates and retains source ages and coverage reasons.

Use `get_token` for one address and `search_pools` for one bounded filtered page.
The resources remain opt-in; the server never fetches the full registry automatically.
[Full agent reference](https://fletch.now/llms-full.txt) and
[live schema](https://fletch.now/api/v1/openapi.json) describe current behavior.
The dated 5 and 8 September documents remain historical;
`docs/openapi-2026-09-10.json` and `docs/llms-2026-09-10.txt` capture the deployed
contract for this update. `docs/SNAPSHOT-2026-09-10.md` records fetch times and hashes.

All tools declare read-only, non-destructive, idempotent, open-world annotations.
These are client hints; account routes still enforce their own authentication.
Token resolution may refresh server-side metadata observations without changing
an account or sending a chain transaction. Changelog cursor reads return the full
sequence: apply kind/symbol filters locally and preserve `nextCursor` after each
processed batch. No returned events does not establish indexing health.

## Market filter contract

Call `filter_catalog` to discover the same filter options used by Markets, then
pass a combination to `token_markets`. Filters combine with AND. Numeric sorts
put unavailable observations last; a zero minimum still requires a usable
reading. V3 quote holdings and V4 bounded 1% depth remain separate measures.

The input enums in `generated/market-filters.json` are generated from the public
catalog. After the matching API release is active, run `npm run generate:filters`
and the offline tests before publishing a client update. No market observations
are bundled in that catalog.

## Structured observation contract

`token_markets` and a token's `reading` preserve each metric's `observation`:
source ID, pinned block/hash when known, upstream `sourceAt`, separate
`fetchedAt`, inclusive `expiresAt`, computation `method`, `parameters`, recursive
`inputs` and coverage. `status` describes current/stale/missing/invalid age;
`readStatus` independently describes ok/partial/failed/unread source access.
Current retained values can coexist with a failed latest refresh. Compare the
expiry with the current clock even after an ETag response, and preserve nulls.

Market cap expires with the earliest required input: supply and burn balances,
decimals and selected-pool price. Volume retains its historical quote inputs and
valuation assumptions. Economic `selection` carries its observation time,
expiry and versioned policy; it cannot establish issuer identity. A beacon
match describes a dependency, with no exception to collision checks.

Status jobs expose nullable `metricCoverage`: eligible/current/failed/unread
counts, oldest input age and measurement time. Current and failed counts can
overlap. Missing coverage has no implied completeness, and a recent job cannot
refresh older metrics. The server forwards these facts unchanged using only the
requested tool read; schema and full documentation resources remain opt-in.

The reliability release's exact public schema snapshot and source hashes are in [the snapshot record](docs/SNAPSHOT-2026-09-10-reliability.md).
