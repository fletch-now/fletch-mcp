# Changelog

## 0.3.1 - 2026-09-14 (prepared)

Clarify crypto-catalog scope, `not_covered` Stock Token status and separate verified stock membership. Add paginated stock/community pairing reads with stable IDs, metadata coverage and complete filtered counts. Expose measured lookalike backfill coverage and preserve source ages. npm publication remains pending.

## 0.3.0 - 2026-09-13

Add Robinhood app catalog reads with pagination, account trading availability,
source age and stale/error flags. Market responses include app status and stock
pairing verdicts. Refresh the public schema and agent examples; document listing
events, watcher baseline suppression and continuous-stream cursor handling.


## Unreleased

- Add `filter_catalog` and paginated `token_markets`, with enums generated from the shared public catalog. Preserve read-only credential isolation.
- Refresh dated live API snapshots on 10 September 2026 and align pool descriptions with separate V3/V4 depth measures and rolling swap coverage. npm publication remains pending.


## 0.2.0 — 2026-09-08 (prepared)

- Refuse redirects, redact configured credentials and omit upstream failure bodies; declare read-only tool annotations.
- Add address resolution and bounded pool search tools. Preserve unknown values, trust and pool-state freshness.
- Document metadata backlog and distinguish legacy activity windows from exact rolling volume.
- Add dated snapshots of the deployed public contract; npm publication remains pending.


## Unreleased

- README: install from GitHub with `npx -y github:fletch-now/fletch-mcp` until the npm package exists.

## 0.1.0 (2026-09-05)

First release.

- 17 tools over the public registry API at https://fletch.now/api/v1: `status`,
  `list_assets`, `get_asset`, `history`, `feed_rounds`, `holders`, `activity`, `pools`,
  `dex_venues`, `bridge`, `issuer_documents`, `lookalikes`, `control_plane`,
  `chain_health`, `events`, `corporate_actions`, `webhooks`.
- Two resources: `llms.txt` and the OpenAPI 3.1 document.
- Responses cached by ETag, at most 200 entries and ten minutes each.
- `FLETCH_API_KEY` is sent only to `/api/v1/webhooks`, and only over https.
- The user-agent carries the package version from `package.json`.
- Snapshots of `llms.txt` and `openapi.json` as served on 2026-09-05 under `docs/`.
