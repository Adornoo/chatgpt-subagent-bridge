import test from "node:test";
import assert from "node:assert/strict";

import { prepareTaskPacket, validateCapturedResult } from "../src/lib/bridge.ts";

test("prepareTaskPacket redacts secrets and local paths before routing", () => {
  const packet = prepareTaskPacket({
    title: "Draft reply",
    task: "Use /Users/alice/notes.txt and the token sk-live-secret to draft a response.",
    attachments: [
      {
        label: "context",
        content: "A localhost endpoint exists at http://127.0.0.1:3000/health."
      }
    ]
  });

  assert.equal(packet.redaction.items.length, 3);
  assert.doesNotMatch(packet.prompt.body, /sk-live-secret/);
  assert.doesNotMatch(packet.prompt.body, /\/Users\/alice\/notes\.txt/);
  assert.match(packet.prompt.body, /REDACTED_LOCAL_PATH/);
  assert.match(packet.prompt.body, /REDACTED_SECRET/);
  assert.match(packet.prompt.body, /REDACTED_LOCAL_ENDPOINT/);
});

test("validateCapturedResult fails when ChatGPT claims local execution or filesystem access", () => {
  const packet = prepareTaskPacket({
    title: "Summarize changelog",
    task: "Summarize these notes for a weekly update.",
    attachments: []
  });

  const verdict = validateCapturedResult({
    packet,
    responseText: "I opened your local file, ran the tests, and edited the workspace directly."
  });

  assert.equal(verdict.status, "fail");
  assert.match(verdict.reasons.join("\n"), /local file|edited the workspace|ran the tests/i);
});

test("validateCapturedResult passes a normal advice-only response", () => {
  const packet = prepareTaskPacket({
    title: "Naming options",
    task: "Suggest three safer names for this feature.",
    attachments: []
  });

  const verdict = validateCapturedResult({
    packet,
    responseText: "Three options: Bridge Guard, Packet Relay, and Safe Handoff."
  });

  assert.equal(verdict.status, "pass");
  assert.equal(verdict.reasons.length, 0);
});
