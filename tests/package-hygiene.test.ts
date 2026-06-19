import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("npm pack dry run includes only the intended public package surface", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "chatgpt-bridge-npm-cache-"));

  try {
    const result = await runCommand("npm", ["pack", "--json", "--dry-run"], packageRoot, {
      npm_config_cache: cacheDirectory
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr.trim(), "");

    const [packSummary] = JSON.parse(result.stdout);
    const files = packSummary.files.map((file: { path: string }) => file.path).sort();

    assert.ok(files.includes("README.md"));
    assert.ok(files.includes("SECURITY.md"));
    assert.ok(files.includes("THREAT_MODEL.md"));
    assert.ok(files.includes("LICENSE"));
    assert.ok(files.includes("bin/chatgpt-bridge.mjs"));
    assert.ok(files.includes("docs/chrome-apple-events-setting.md"));
    assert.ok(files.includes("src/cli.ts"));
    assert.ok(files.includes("src/lib/bridge.ts"));
    assert.ok(files.includes("src/lib/chrome.ts"));
    assert.ok(files.includes("src/lib/schema.ts"));
    assert.ok(files.includes("package.json"));

    assert.ok(!files.some((file: string) => file.startsWith("bridge_runs/")));
    assert.ok(!files.some((file: string) => file.startsWith("tests/")));
    assert.ok(!files.some((file: string) => file.startsWith("tests/fixtures/")));
    assert.ok(!files.some((file: string) => /final-validation/i.test(file)));
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
