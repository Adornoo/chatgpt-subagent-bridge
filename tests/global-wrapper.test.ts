import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = join(packageRoot, "bin", "chatgpt-bridge.mjs");

test("global wrapper help works from an unrelated working directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chatgpt-bridge-wrapper-"));

  try {
    const result = await runNode([wrapperPath, "help"], cwd);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /chatgpt-subagent-bridge/);
    assert.match(result.stdout, /prepare/);
    assert.equal(result.stderr.trim(), "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("global wrapper prepare works from an unrelated working directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chatgpt-bridge-wrapper-"));

  try {
    const result = await runNode(
      [
        wrapperPath,
        "prepare",
        "--title",
        "Wrapper test",
        "--task",
        "Summarize these notes from /Users/example/private.txt in two bullets."
      ],
      cwd
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Wrapper test/);
    assert.match(result.stdout, /REDACTED_LOCAL_PATH/);
    assert.equal(result.stderr.trim(), "");
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
