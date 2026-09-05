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
  "list_assets",
  "get_asset",
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
  const handle = (request, response) => {
    seen.push({ path: request.url, headers: request.headers });
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
      resolve({ server, seen, url: `${scheme}://localhost:${server.address().port}` });
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

  test("registers 17 tools and 2 resources", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    const { resources } = await client.listResources();
    assert.equal(resources.length, 2);
    assert.deepEqual(
      resources.map((resource) => resource.uri).sort(),
      [`${fake.url}/api/v1/openapi.json`, `${fake.url}/llms.txt`],
    );
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
    assert.equal(again.served, 1, "the body must be the one cached from the first 200");
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
