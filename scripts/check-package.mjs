import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "fletch-mcp-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

try {
  const output = execFileSync(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
    cwd: repository,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(output);
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temporary, packed.filename)], {
    cwd: temporary,
    stdio: "inherit",
  });
  const installed = join(temporary, "node_modules/fletch-mcp");
  assert.equal(JSON.parse(await readFile(join(installed, "package.json"), "utf8")).version, manifest.version);
  assert.equal(await readFile(join(installed, "LICENSE"), "utf8"), await readFile(new URL("../LICENSE", import.meta.url), "utf8"));
  execFileSync(process.execPath, ["--test", "test/smoke.test.mjs"], {
    cwd: repository,
    stdio: "inherit",
    env: { ...process.env, FLETCH_MCP_TEST_ENTRY: join(installed, "index.mjs"), FLETCH_MCP_TEST_OFFLINE: "1" },
  });
  console.log(`Installed ${packed.name}@${packed.version}; stdio tools, dependencies and license passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
