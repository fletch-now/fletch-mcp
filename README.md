<p align="center"><img src="https://raw.githubusercontent.com/fletch-now/fletch-mcp/main/docs/fletch-logo.png" width="160" alt="Fletch"></p>

# fletch-mcp

Fletch's Robinhood Chain registry as [MCP](https://modelcontextprotocol.io) tools: verified
Stock Token addresses, live state (multiplier, pauses, Chainlink price, holders), round
history, lookalike tokens, the issuer's control plane, chain health and the changelog.
A thin client of the public API at https://fletch.now; registry reads need no key.

```
npx -y fletch-mcp
```

[fletch.now/developers](https://fletch.now/developers) ·
[API reference](https://fletch.now/api/v1/docs) ·
[Registry](https://fletch.now/registry) ·
[llms.txt](https://fletch.now/llms.txt)

## Use

Claude Desktop, Claude Code, Cursor and any other MCP client take a stdio server:

```json
{
  "mcpServers": {
    "fletch": { "command": "npx", "args": ["-y", "fletch-mcp"] }
  }
}
```

Claude Code: `claude mcp add fletch -- npx -y fletch-mcp`.

## Environment

- `FLETCH_API_URL`: where the API lives. Default `https://fletch.now`.
- `FLETCH_API_KEY`: optional. Needed only by `webhooks`, which reads one account's own
  endpoints. The key is sent to `/api/v1/webhooks` and to no other route, and never over
  plain http; with an `http://` base the `webhooks` tool returns an error instead.

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
| `pools` | pools trading one ticker on every DEX read (Uniswap v4 and v3), deepest first: venue, price, `depthUsd` (dollars that move the price 1%), raw liquidity L, premium to feed, and how far each venue's scan has read |
| `dex_venues` | which DEXs exist on this chain and what each is worth: pools, dollar-priced pools, dollar depth at a 1% move, swaps and volume, assets priced there, and whether each venue has been read at all |
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
watcher routes, the event stream at `/events/stream`, and the build and project routes
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
