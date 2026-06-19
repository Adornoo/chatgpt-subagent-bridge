import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareTaskPacket } from "../src/lib/bridge.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = join(packageRoot, "bin", "chatgpt-bridge.mjs");

test("validate exits non-zero when the verdict fails", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-cli-"));

  try {
    const packetPath = await writePacketFixture(workspaceRoot);
    const result = await runNode(
      [
        wrapperPath,
        "validate",
        "--packet",
        packetPath,
        "--response",
        "I opened the local file, ran the tests, and updated the workspace."
      ],
      workspaceRoot
    );

    assert.equal(result.code, 2);
    assert.equal(result.stderr.trim(), "");

    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.status, "fail");
    assert.match(verdict.reasons.join("\n"), /local file|workspace|tests/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("validate can explicitly allow a failed verdict and still exit zero", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-cli-"));

  try {
    const packetPath = await writePacketFixture(workspaceRoot);
    const result = await runNode(
      [
        wrapperPath,
        "validate",
        "--packet",
        packetPath,
        "--response",
        "I opened the local file, ran the tests, and updated the workspace.",
        "--allow-failed-verdict"
      ],
      workspaceRoot
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr.trim(), "");

    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.status, "fail");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("capture exits non-zero when the stored verdict fails", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-cli-"));

  try {
    const packetPath = await writePacketFixture(workspaceRoot);
    const result = await runNode(
      [
        wrapperPath,
        "capture",
        "--packet",
        packetPath,
        "--run-directory",
        workspaceRoot,
        "--response",
        "I opened the local file, ran the tests, and updated the workspace."
      ],
      workspaceRoot
    );

    assert.equal(result.code, 2);

    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.verdict, "fail");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function writePacketFixture(workspaceRoot: string): Promise<string> {
  const packet = prepareTaskPacket({
    title: "CLI validation test",
    task: "Suggest three ways to phrase this release note more clearly.",
    attachments: []
  });

  const packetPath = join(workspaceRoot, "task-packet.json");
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return packetPath;
}

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
