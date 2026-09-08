# Changelog

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
