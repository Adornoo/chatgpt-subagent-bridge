import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareTaskPacket, routeTaskThroughBridge } from "../src/lib/bridge.ts";

async function makeWorkspace() {
  return mkdtemp(join(tmpdir(), "chatgpt-bridge-risk-"));
}

test("low or medium risk redacted packets can auto-send", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const packet = prepareTaskPacket({
      title: "Summarize notes",
      task: [
        "Please summarize the notes in /Users/alice/private/notes.md.",
        "A local helper is running at http://127.0.0.1:3000/health."
      ].join(" "),
      attachments: []
    });

    assert.ok(["low", "medium"].includes(packet.risk.level));

    let sent = false;

    await routeTaskThroughBridge({
      workspaceRoot,
      packet,
      adapter: {
        async sendAndCapture(request) {
          sent = true;
          assert.doesNotMatch(request.prompt, /\/Users\/alice\/private\/notes\.md/);
          assert.doesNotMatch(request.prompt, /127\.0\.0\.1:3000/);
          assert.match(request.prompt, /REDACTED_LOCAL_PATH/);
          assert.match(request.prompt, /REDACTED_LOCAL_ENDPOINT/);

          return {
            responseText: "Summary delivered.",
            captureMeta: {
              channel: "fake"
            }
          };
        }
      }
    });

    assert.equal(sent, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("local filesystem paths are redacted from the packet body", () => {
  const packet = prepareTaskPacket({
    title: "Draft reply",
    task: "Use /Users/alice/Documents/client-plan.md when you write the reply.",
    attachments: []
  });

  assert.doesNotMatch(packet.prompt.body, /\/Users\/alice\/Documents\/client-plan\.md/);
  assert.match(packet.prompt.body, /REDACTED_LOCAL_PATH/);
});

test("localhost and internal endpoints are redacted from the packet body", () => {
  const packet = prepareTaskPacket({
    title: "Check service health",
    task: "Verify http://localhost:8080/health and http://10.0.0.8:9090/internal for me.",
    attachments: []
  });

  assert.doesNotMatch(packet.prompt.body, /localhost:8080/);
  assert.doesNotMatch(packet.prompt.body, /10\.0\.0\.8:9090/);
  assert.match(packet.prompt.body, /REDACTED_LOCAL_ENDPOINT/);
});

test("sensitive personal data or secrets raise confirmation or block behavior", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const packet = prepareTaskPacket({
      title: "Review payroll export",
      task: "Check employee SSNs 123-45-6789 and 987-65-4321 plus token sk-live-secret.",
      attachments: []
    });

    assert.ok(["high", "critical"].includes(packet.risk.level));

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

test("blocked secret detection stays stable across repeated calls", () => {
  const firstPacket = prepareTaskPacket({
    title: "Blocked key one",
    task: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    attachments: []
  });
  const secondPacket = prepareTaskPacket({
    title: "Blocked key two",
    task: "-----BEGIN PRIVATE KEY-----\ndef\n-----END PRIVATE KEY-----",
    attachments: []
  });

  assert.equal(firstPacket.deliveryPolicy.mode, "block");
  assert.equal(secondPacket.deliveryPolicy.mode, "block");
});
