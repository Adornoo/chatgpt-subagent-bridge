import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareTaskPacket, routeTaskThroughBridge } from "../src/lib/bridge.ts";

test("routeTaskThroughBridge stores a redacted packet, captured result, and pass verdict", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const packet = prepareTaskPacket({
      title: "Summarize release notes",
      task: "Please summarize the release notes in three bullets. The local path is /Users/example/private/report.md.",
      attachments: [
        {
          label: "release-notes",
          content: "Version 1.2.0 adds exports and fixes a date formatting bug."
        }
      ]
    });

    const run = await routeTaskThroughBridge({
      workspaceRoot,
      packet,
      adapter: {
        async sendAndCapture(request) {
          assert.match(request.prompt, /local filesystem/i);
          assert.doesNotMatch(request.prompt, /\/Users\/example\/private\/report\.md/);

          return {
            responseText: [
              "Here are three bullets:",
              "- Added export support.",
              "- Fixed the date formatting bug.",
              "- Version 1.2.0 is now easier to share."
            ].join("\n"),
            captureMeta: {
              channel: "fake"
            }
          };
        }
      }
    });

    const requestFile = join(run.runDirectory, "task-packet.json");
    const resultFile = join(run.runDirectory, "result-packet.json");
    const verdictFile = join(run.runDirectory, "validation-verdict.json");

    await stat(requestFile);
    await stat(resultFile);
    await stat(verdictFile);

    const requestJson = JSON.parse(await readFile(requestFile, "utf8"));
    const resultJson = JSON.parse(await readFile(resultFile, "utf8"));
    const verdictJson = JSON.parse(await readFile(verdictFile, "utf8"));

    assert.equal(requestJson.risk.level, "medium");
    assert.equal(resultJson.captureMeta.channel, "fake");
    assert.equal(verdictJson.status, "pass");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("routeTaskThroughBridge blocks a sensitive packet unless confirmation is provided", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const packet = prepareTaskPacket({
      title: "Review payroll export",
      task: "Check this payroll export with employee SSNs 123-45-6789 and 987-65-4321.",
      attachments: []
    });

    await assert.rejects(
      routeTaskThroughBridge({
        workspaceRoot,
        packet,
        adapter: {
          async sendAndCapture() {
            throw new Error("should not send");
          }
        }
      }),
      /requires confirmation/i
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("routeTaskThroughBridge records a blocker artifact when Chrome delivery fails", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const packet = prepareTaskPacket({
      title: "Browser blocker",
      task: "Reply with exactly BRIDGE_OK.",
      attachments: []
    });

    await assert.rejects(
      routeTaskThroughBridge({
        workspaceRoot,
        packet,
        adapter: {
          async sendAndCapture() {
            throw new Error("Allow JavaScript from Apple Events is disabled.");
          }
        }
      }),
      /Allow JavaScript from Apple Events/i
    );

    const runRoot = join(workspaceRoot, "bridge_runs");
    const [runFolder] = await readdir(runRoot);
    const blockerJson = JSON.parse(
      await readFile(join(runRoot, runFolder, "route-error.json"), "utf8")
    );

    assert.equal(blockerJson.stage, "send_or_capture");
    assert.match(blockerJson.message, /Allow JavaScript from Apple Events/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("routeTaskThroughBridge uses unique run directories for packets with the same title", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const adapter = {
      async sendAndCapture() {
        return {
          responseText: "Bridge reply.",
          captureMeta: {
            channel: "fake"
          }
        };
      }
    };

    const firstPacket = prepareTaskPacket({
      title: "Repeated title",
      task: "Summarize the first note.",
      attachments: []
    });
    const secondPacket = prepareTaskPacket({
      title: "Repeated title",
      task: "Summarize the second note.",
      attachments: []
    });

    const [firstRun, secondRun] = await Promise.all([
      routeTaskThroughBridge({ workspaceRoot, packet: firstPacket, adapter }),
      routeTaskThroughBridge({ workspaceRoot, packet: secondPacket, adapter })
    ]);

    assert.notEqual(firstRun.runDirectory, secondRun.runDirectory);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
