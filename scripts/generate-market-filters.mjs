// Generate the MCP enum schema from Fletch's public filter catalog.
import { readFile, writeFile } from "node:fs/promises";
const input = process.argv[2];
let catalog;
if (input) {
  catalog = JSON.parse(await readFile(input, "utf8"));
} else {
  const response = await fetch("https://fletch.now/api/v1/chains/4663/markets/filters", { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) throw new Error(`Filter catalog HTTP ${response.status}`);
  catalog = await response.json();
}
if (catalog.chainId !== 4663 || catalog.version !== 1 || !catalog.filters || !catalog.minVolumeUsd) throw new Error("Unsupported market filter catalog");
for (const filter of Object.values(catalog.filters)) {
  if (!Array.isArray(filter.options) || !filter.options.length || filter.options.some(option => typeof option.value !== "string")) throw new Error("Invalid filter options");
}
await writeFile(new URL("../generated/market-filters.json", import.meta.url), JSON.stringify(catalog, null, 2) + "\n");
