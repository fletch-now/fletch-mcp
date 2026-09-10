// Starts index.mjs the way an MCP client does, over stdio, and checks the
// things a release can break: the tool and resource counts, the ETag cache,
// the bearer rule, and one live call to fletch.now.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// fileURLToPath, not pathname: a checkout under a directory with a space
// would otherwise hand the transport a percent-encoded path to spawn.
const INDEX = fileURLToPath(new URL("../index.mjs", import.meta.url));
// A self-signed pair for localhost that guards nothing outside this test. The
// server trusts it through NODE_EXTRA_CA_CERTS, which Node reads at start-up,
// so it has to reach index.mjs through the spawn environment.
const CERT_PATH = fileURLToPath(new URL("./fixtures/localhost-cert.pem", import.meta.url));
const KEY_PATH = fileURLToPath(new URL("./fixtures/localhost-key.pem", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const TOOL_NAMES = [
  "status",
  "token_markets",
  "filter_catalog",
  "list_assets",
  "get_asset",
  "get_token",
  "search_pools",
  "history",
  "feed_rounds",
  "holders",
  "activity",
  "pools",
  "dex_venues",
  "bridge",
  "issuer_documents",
  "lookalikes",
  "control_plane",
  "chain_health",
  "events",
  "corporate_actions",
  "webhooks",
];

const STATUS_VERDICTS = ["live", "degraded", "stale", "never"];

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [INDEX],
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "fletch-mcp-smoke", version });
  await client.connect(transport);
  return client;
}

function parse(result) {
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

// A stand-in for fletch.now that records every request it sees and answers
// with an ETag, so the cache and the bearer rule can be checked offline.
// Over https it is the same handler behind the test certificate, which is the
// only way to watch the bearer actually leave the process.
function startFake(scheme = "http") {
  const seen = [];
  let override = null;
  const handle = (request, response) => {
    seen.push({ path: request.url, headers: request.headers });
    if (override) { override(request, response); return; }
    if (request.url === "/api/v1/status") {
      if (request.headers["if-none-match"] === '"s1"') {
        response.writeHead(304);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json", etag: '"s1"' });
      response.end(JSON.stringify({ verdict: "live", served: seen.length }));
      return;
    }
    if (request.url.startsWith("/api/v1/chains/4663/dex/pools?")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ pools: [{ stateCurrent: false, pricePublished: false, priceUsd: null, depthUsd: null, stateCheckedAt: "2026-09-05T00:00:00Z" }], total: 900000 }));
      return;
    }
    if (request.url.startsWith("/api/v1/tokens/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ address: request.url.split("/").at(-1), trust: "unknown", symbol: null }));
      return;
    }
    if (request.url.startsWith("/api/v1/chains/4663/markets")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url, items: [], total: 0 }));
      return;
    }
    if (request.url === "/api/v1/webhooks") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ webhooks: [] }));
      return;
    }
    response.writeHead(404);
    response.end();
  };
  const server = scheme === "https"
    ? createHttpsServer({ cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) }, handle)
    : createServer(handle);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, seen, url: `${scheme}://localhost:${server.address().port}`, setResponse(handle) { override = handle; } });
    });
  });
}

describe("over stdio against a local server", () => {
  let fake;
  let client;

  before(async () => {
    fake = await startFake();
    client = await connect({ FLETCH_API_URL: fake.url, FLETCH_API_KEY: "flk_test_only" });
  });

  after(async () => {
    await client.close();
    fake.server.close();
  });

  test("registers 21 tools and 2 resources", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
      assert.equal(tool.inputSchema.type, "object");
    }
    const tokenSchema = tools.find(tool => tool.name === "get_token").inputSchema;
    assert.deepEqual(tokenSchema.required, ["address"]);
    assert.ok(tokenSchema.properties.address.pattern);
    const poolSchema = tools.find(tool => tool.name === "search_pools").inputSchema;
    assert.equal(poolSchema.properties.limit.maximum, 500);
    assert.equal(poolSchema.properties.limit.minimum, 1);
    const { resources } = await client.listResources();
    assert.equal(resources.length, 2);
    assert.deepEqual(
      resources.map((resource) => resource.uri).sort(),
      [`${fake.url}/api/v1/openapi.json`, `${fake.url}/llms.txt`],
    );
  });

  test("market schema matches generated public catalog and reads without account credentials", async () => {
    const catalog = JSON.parse(readFileSync(new URL("../generated/market-filters.json", import.meta.url), "utf8"));
    const { tools } = await client.listTools();
    const schema = tools.find(tool => tool.name === "token_markets").inputSchema;
    for (const [key, filter] of Object.entries(catalog.filters)) {
      assert.deepEqual(schema.properties[key].enum, filter.options.map(option => option.value));
    }
    parse(await client.callTool({ name: "filter_catalog", arguments: {} }));
    assert.equal(fake.seen.at(-1).path, "/api/v1/chains/4663/markets/filters");
    parse(await client.callTool({ name: "token_markets", arguments: { kind: "community", activity: "traded", sort: "swaps", page: 2, pageSize: 25, minVolumeUsd: 0 } }));
    const request = fake.seen.at(-1);
    const url = new URL(request.path, fake.url);
    assert.equal(url.pathname, "/api/v1/chains/4663/markets");
    assert.equal(url.searchParams.get("minVolumeUsd"), "0");
    assert.equal(url.searchParams.get("sort"), "swaps");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(request.headers.authorization, undefined);
    const before = fake.seen.length;
    const invalid = await client.callTool({ name: "token_markets", arguments: { sort: "invented_sort" } });
    assert.equal(invalid.isError, true);
    assert.equal(fake.seen.length, before);
  });

  test("sends the versioned user-agent and no bearer on a registry read", async () => {
    const first = parse(await client.callTool({ name: "status", arguments: {} }));
    assert.equal(first.verdict, "live");
    const request = fake.seen.at(-1);
    assert.equal(request.path, "/api/v1/status");
    assert.equal(request.headers["user-agent"], `fletch-mcp/${version} (+https://fletch.now)`);
    assert.equal(request.headers.authorization, undefined);
  });

  test("revalidates by ETag and serves the cached body on 304", async () => {
    const before = fake.seen.length;
    const again = parse(await client.callTool({ name: "status", arguments: {} }));
    const request = fake.seen.at(-1);
    assert.equal(fake.seen.length, before + 1);
    assert.equal(request.headers["if-none-match"], '"s1"');
    assert.equal(again.served, fake.seen.findIndex(request => request.path === "/api/v1/status") + 1, "the body must be the one cached from the first 200");
  });

  test("preserves metric inputs, selection expiry and partial status coverage with narrow reads", async () => {
    const observation = {
      sourceId: "rpc:erc20", blockNumber: "123", blockHash: null,
      sourceAt: "2026-09-10T20:00:00Z", fetchedAt: "2026-09-10T20:00:01Z", expiresAt: "2026-09-10T20:05:00Z",
      status: "current", readStatus: "failed", method: "erc20_totalSupply", parameters: {}, inputs: [],
      coverage: { status: "complete", scope: "token", windowStartAt: null, windowEndAt: null },
    };
    const markets = { items: [{ address: `0x${"1".repeat(40)}`, dominantAddress: null,
      selection: { selectedAt: null, expiresAt: null, status: "missing", policy: "fixture" },
      marketCapUsd: { value: null, observation: { ...observation, inputs: [{ name: "supply", value: "100", asOf: observation.sourceAt, observation }] } },
    }], total: 1 };
    const status = { verdict: "degraded", jobs: [{ metricCoverage: { supply: {
      eligible: 1, current: 1, failed: 1, unread: 0, oldestInputAgeSeconds: 20, measuredAt: "2026-09-10T20:00:20Z",
    } } }] };
    const before = fake.seen.length;
    fake.setResponse((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url.includes("/status") ? status : markets));
    });
    try {
      assert.deepEqual(parse(await client.callTool({ name: "token_markets", arguments: { q: "TSLA", pageSize: 25 } })), markets);
      assert.deepEqual(parse(await client.callTool({ name: "status", arguments: {} })), status);
      assert.equal(fake.seen.length, before + 2, "no unrequested registry discovery");
      const { tools } = await client.listTools();
      assert.match(tools.find((tool) => tool.name === "token_markets").description, /expiresAt.*inputs/);
      assert.match(tools.find((tool) => tool.name === "status").description, /metricCoverage/);
    } finally { fake.setResponse(null); }
  });

  test("new public tools make one bounded read and preserve unknown and stale facts", async () => {
    const before = fake.seen.length;
    const pools = parse(await client.callTool({ name: "search_pools", arguments: {} }));
    assert.equal(fake.seen.length, before + 1, "never auto-page a whole registry");
    assert.equal(fake.seen.at(-1).path, "/api/v1/chains/4663/dex/pools?sort=volume&limit=20");
    assert.equal(fake.seen.at(-1).headers.authorization, undefined);
    assert.deepEqual(pools.pools[0], { stateCurrent: false, pricePublished: false, priceUsd: null, depthUsd: null, stateCheckedAt: "2026-09-05T00:00:00Z" });
    const address = `0x${"a".repeat(40)}`;
    const token = parse(await client.callTool({ name: "get_token", arguments: { address } }));
    assert.deepEqual(token, { address, trust: "unknown", symbol: null });
    assert.equal(fake.seen.at(-1).headers.authorization, undefined);
    parse(await client.callTool({ name: "search_pools", arguments: { q: address, kind: "community", limit: 5, offset: 10 } }));
    assert.equal(fake.seen.at(-1).path, `/api/v1/chains/4663/dex/pools?q=${address}&kind=community&sort=volume&limit=5&offset=10`);
    const count = fake.seen.length;
    const invalid = await client.callTool({ name: "get_token", arguments: { address: "TSLA" } });
    assert.equal(invalid.isError, true);
    const tooMany = await client.callTool({ name: "search_pools", arguments: { limit: 501 } });
    assert.equal(tooMany.isError, true);
    assert.equal(fake.seen.length, count, "invalid inputs never dispatch");
  });

  test("refuses to send the key over plain http", async () => {
    const before = fake.seen.length;
    const result = await client.callTool({ name: "webhooks", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /only sent over https/);
    assert.equal(fake.seen.length, before, "no request may leave without the rule holding");
  });
});

describe("over stdio against a local https server", () => {
  let fake;
  let client;

  before(async () => {
    fake = await startFake("https");
    client = await connect({ FLETCH_API_URL: fake.url, FLETCH_API_KEY: "flk_test_only", NODE_EXTRA_CA_CERTS: CERT_PATH });
  });

  after(async () => {
    await client.close();
    fake.server.close();
  });

  test("refuses same-origin redirects before a key can reach another route", async () => {
    const before = fake.seen.length;
    fake.setResponse((_request, response) => {
      response.writeHead(302, { location: "/api/v1/status" });
      response.end();
    });
    try {
      const result = await client.callTool({ name: "webhooks", arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /refused redirect/);
      assert.equal(fake.seen.length, before + 1);
      assert.equal(fake.seen.at(-1).path, "/api/v1/webhooks");
    } finally { fake.setResponse(null); }
  });

  test("upstream failures and malformed successes never expose body text or the configured key", async () => {
    try {
      for (const status of [403, 429, 500, 200]) {
        fake.setResponse((request, response) => {
          response.writeHead(status, { "content-type": "text/html" });
          response.end(`PRIVATE_UPSTREAM_DETAIL ${request.headers.authorization}`);
        });
        const result = await client.callTool({ name: "webhooks", arguments: {} });
        assert.equal(result.isError, true);
        const output = JSON.stringify(result);
        assert.ok(output.includes(String(status)));
        assert.equal(output.includes("flk_test_only"), false);
        assert.equal(output.includes("PRIVATE_UPSTREAM_DETAIL"), false);
      }
      fake.setResponse((request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ webhooks: [], echoed: request.headers.authorization }));
      });
      const success = parse(await client.callTool({ name: "webhooks", arguments: {} }));
      assert.equal(success.echoed, "Bearer [redacted]");
    } finally { fake.setResponse(null); }
  });

  test("resource reads refuse redirects without sending an account key", async () => {
    const before = fake.seen.length;
    fake.setResponse((_request, response) => {
      response.writeHead(302, { location: "/api/v1/webhooks" });
      response.end();
    });
    try {
      await assert.rejects(client.readResource({ uri: fake.url + "/llms.txt" }), /refused redirect/);
      assert.equal(fake.seen.length, before + 1);
      assert.equal(fake.seen.at(-1).headers.authorization, undefined);
    } finally { fake.setResponse(null); }
  });

  test("sends the key to /api/v1/webhooks and to no other route", async () => {
    const webhooks = parse(await client.callTool({ name: "webhooks", arguments: {} }));
    assert.deepEqual(webhooks, { webhooks: [] });
    const keyed = fake.seen.at(-1);
    assert.equal(keyed.path, "/api/v1/webhooks");
    assert.equal(keyed.headers.authorization, "Bearer flk_test_only");

    parse(await client.callTool({ name: "status", arguments: {} }));
    const unkeyed = fake.seen.at(-1);
    assert.equal(unkeyed.path, "/api/v1/status");
    assert.equal(unkeyed.headers.authorization, undefined);
  });
});

describe("against https://fletch.now", () => {
  let client;

  before(async () => {
    client = await connect({ FLETCH_API_URL: "https://fletch.now", FLETCH_API_KEY: "" });
  });

  after(async () => {
    await client.close();
  });

  test("status answers with a registry verdict", async () => {
    const status = parse(await client.callTool({ name: "status", arguments: {} }));
    assert.equal(status.chainId, 4663);
    assert.ok(STATUS_VERDICTS.includes(status.verdict), `verdict was ${status.verdict}`);
    assert.ok(Array.isArray(status.jobs) && status.jobs.length > 0);
    assert.ok(Number.isFinite(Date.parse(status.checkedAt)));
  });
});


test("the distributable contains only its explicit public files and matching executable version", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = fileURLToPath(new URL("../", import.meta.url));
  const { stdout } = await promisify(execFile)(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: directory });
  const [packed] = JSON.parse(stdout);
  assert.equal(packed.name, "fletch-mcp");
  assert.equal(packed.version, version);
  assert.deepEqual(packed.files.map(file => file.path).sort(), ["CHANGELOG.md", "LICENSE", "README.md", "generated/market-filters.json", "index.mjs", "package.json"]);
  assert.ok((packed.files.find(file => file.path === "index.mjs").mode & 0o111) !== 0);
  const source = readFileSync(INDEX, "utf8");
  assert.ok(source.startsWith("#!/usr/bin/env node"));
});
