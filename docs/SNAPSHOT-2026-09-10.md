# Snapshot

Fetched 2026-09-10T00:01:24.103Z by `scripts/snapshot.mjs`. Each file is the response body exactly as
served; the hash is over those bytes. The live documents change when Fletch deploys, so
compare before assuming the copy here is current.

| File | Source | Server date | Bytes | SHA-256 |
|---|---|---|---|---|
| `spec/openapi.json` | https://fletch.now/api/v1/openapi.json | Thu, 10 Sep 2026 00:01:23 GMT | 130767 | `990f52683d5746f279ce71fcf71a77bb8c07b6057cd46d471bf8022f92fb53a9` |
| `spec/llms.txt` | https://fletch.now/llms.txt | Thu, 10 Sep 2026 00:01:24 GMT | 17201 | `35fad5a02a8618bb761a57ce8073d0b3bc18655e3c96fbb0e16233ecea11e349` |

To refresh: `npm run snapshot && npm run generate`, then commit `spec/` and
`packages/fletch-sdk/src/generated/` together.
