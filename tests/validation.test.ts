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

test("validateCapturedResult passes a representative deep research brief response", () => {
  const packet = prepareTaskPacket({
    title: "Deep research brief for market map",
    task: "Create a research brief for a market map and route the follow-up work across separate model passes.",
    attachments: [],
    workMode: "deep-research-brief"
  });
  const longSection = "Evidence criterion: cite the source, date, claim, confidence, and follow-up gap. ".repeat(95);
  const responseText = [
    "Objective: produce a source-bound market map brief.",
    "Thread plan: the developer should open a steering thread, then create separate evidence, synthesis, and review threads.",
    "Model route: use 5.4 High for primary synthesis, 5.4 Mini High for narrow evidence extraction, and 5.5 High for final challenge review.",
    "Research plan: gather current sources, compare claims, flag uncertainty, and write only future-tense implementation steps.",
    longSection
  ].join("\n\n");

  assert.ok(responseText.length > 8000);
  assert.equal(packet.deliveryPolicy.maxResponseChars, 20000);

  const verdict = validateCapturedResult({
    packet,
    responseText
  });

  assert.equal(verdict.status, "pass");
  assert.equal(verdict.reasons.length, 0);
});
