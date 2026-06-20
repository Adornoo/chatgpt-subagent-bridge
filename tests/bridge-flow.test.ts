import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeDeepResearchThroughBridge,
  prepareTaskPacket,
  routeTaskThroughBridge,
  startDeepResearchThroughBridge
} from "../src/lib/bridge.ts";
import { findLatestMarkdownDownload } from "../src/lib/chrome.ts";

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

test("deep research brief mode keeps packet-only guardrails and asks for a threaded plan", () => {
  const packet = prepareTaskPacket({
    title: "Deep research launch plan",
    task: "Plan a deep research brief for a product category.",
    attachments: [],
    workMode: "deep-research-brief"
  });

  assert.match(packet.prompt.body, /You do not have direct local filesystem, shell, terminal, or tunnel access/i);
  assert.match(packet.prompt.body, /Do not claim that you opened local files, ran commands, edited the workspace, or executed tests/i);
  assert.match(packet.prompt.body, /Deep research brief mode/i);
  assert.match(packet.prompt.body, /separate research, synthesis, implementation, and review threads/i);
  assert.match(packet.prompt.body, /5\.4 High/i);
  assert.match(packet.prompt.body, /5\.4 Mini High/i);
  assert.match(packet.prompt.body, /5\.5 High/i);
});

test("startDeepResearchThroughBridge stores the proposed research approach without confirming it", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const packet = prepareTaskPacket({
      title: "Usage optimization research",
      task: "Research how to maximize consumer AI subscription value without using API billing.",
      attachments: []
    });

    const run = await startDeepResearchThroughBridge({
      workspaceRoot,
      packet,
      adapter: {
        async submitResearchPlan(request) {
          assert.match(request.prompt, /Remote collaboration packet/i);
          assert.equal(request.runDirectory.includes("usage-optimization-research"), true);

          return {
            approachText: "I will compare official usage policies, reset windows, and practical routing patterns.",
            captureMeta: {
              channel: "fake"
            }
          };
        },
        async requestResearchReport() {
          throw new Error("should not confirm report during start");
        }
      }
    });

    assert.equal(run.approachText, "I will compare official usage policies, reset windows, and practical routing patterns.");
    assert.equal(await readFile(run.approachPath, "utf8"), `${run.approachText}\n`);
    await stat(join(run.runDirectory, "task-packet.json"));
    await stat(join(run.runDirectory, "task-packet.md"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("completeDeepResearchThroughBridge can send feedback, then stores the final report and verdict", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));

  try {
    const packet = prepareTaskPacket({
      title: "Usage optimization research",
      task: "Research how to maximize consumer AI subscription value without using API billing.",
      attachments: []
    });

    const started = await startDeepResearchThroughBridge({
      workspaceRoot,
      packet,
      adapter: {
        async submitResearchPlan() {
          return {
            approachText: "I will compare marketing pages only.",
            captureMeta: {
              channel: "fake"
            }
          };
        },
        async requestResearchReport() {
          throw new Error("should not confirm report during start");
        }
      }
    });

    const completed = await completeDeepResearchThroughBridge({
      runDirectory: started.runDirectory,
      packet,
      approachFeedback: "Also use official help-center docs and distinguish Plus from Pro.",
      adapter: {
        async submitResearchPlan() {
          throw new Error("should not submit a new plan during completion");
        },
        async reviseResearchApproach(request) {
          assert.equal(request.feedback, "Also use official help-center docs and distinguish Plus from Pro.");
          return {
            approachText: "Revised: I will prioritize official help-center docs and separate Plus from Pro.",
            captureMeta: {
              channel: "fake"
            }
          };
        },
        async requestResearchReport(request) {
          assert.match(request.approachText, /official help-center/i);
          return {
            responseText: "# Report\n\nUse Plus for breadth and Claude Pro for coding sprints.",
            captureMeta: {
              channel: "fake"
            }
          };
        }
      }
    });

    assert.equal(completed.verdict.status, "pass");
    assert.equal(
      await readFile(join(started.runDirectory, "research-approach-revised.md"), "utf8"),
      "Revised: I will prioritize official help-center docs and separate Plus from Pro.\n"
    );
    assert.match(await readFile(join(started.runDirectory, "result-raw.md"), "utf8"), /# Report/);
    assert.equal(completed.resultPacket.captureMeta.channel, "fake");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("findLatestMarkdownDownload returns the newest completed Markdown export after a cutoff", async () => {
  const downloadRoot = await mkdtemp(join(tmpdir(), "chatgpt-bridge-downloads-"));

  try {
    const oldPath = join(downloadRoot, "old-report.md");
    const firstPath = join(downloadRoot, "deep-research-report.md");
    const latestPath = join(downloadRoot, "deep-research-report (1).md");
    const partialPath = join(downloadRoot, "deep-research-report.md.crdownload");
    const cutoffMs = Date.now();

    await writeFile(oldPath, "old", "utf8");
    await writeFile(firstPath, "first", "utf8");
    await writeFile(latestPath, "latest", "utf8");
    await writeFile(partialPath, "partial", "utf8");

    await utimes(oldPath, new Date(cutoffMs - 5000), new Date(cutoffMs - 5000));
    await utimes(firstPath, new Date(cutoffMs + 1000), new Date(cutoffMs + 1000));
    await utimes(latestPath, new Date(cutoffMs + 2000), new Date(cutoffMs + 2000));

    assert.equal(await findLatestMarkdownDownload(downloadRoot, cutoffMs), latestPath);
    assert.equal(await findLatestMarkdownDownload(join(downloadRoot, "missing"), cutoffMs), null);
  } finally {
    await rm(downloadRoot, { recursive: true, force: true });
  }
});
