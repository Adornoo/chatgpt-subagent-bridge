import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = join(packageRoot, "bin", "chatgpt-bridge.mjs");

test("help text states the current safety and release posture", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chatgpt-bridge-help-"));

  try {
    const result = await runNode([wrapperPath, "help"], cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr.trim(), "");
    assert.match(result.stdout, /MIT-licensed/i);
    assert.match(result.stdout, /attended drafting/i);
    assert.match(result.stdout, /do not use this for secrets, regulated data/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("help text explains route workspace-root behavior and shows it in examples", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chatgpt-bridge-help-"));

  try {
    const result = await runNode([wrapperPath, "help"], cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr.trim(), "");
    assert.match(result.stdout, /bridge_runs\/ under the selected workspace root/i);
    assert.match(result.stdout, /defaults to the current working directory/i);
    assert.match(result.stdout, /deep-research-brief/i);
    assert.match(result.stdout, /chatgpt-bridge route .*--workspace-root/i);
    assert.match(result.stdout, /chatgpt-bridge capture .*--run-directory/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function runNode(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
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
