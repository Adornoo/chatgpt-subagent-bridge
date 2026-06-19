import test from "node:test";
import assert from "node:assert/strict";

import { prepareTaskPacket, renderTaskPacketMarkdown } from "../src/lib/bridge.ts";

test("renderTaskPacketMarkdown prints a single no-redactions line", () => {
  const packet = prepareTaskPacket({
    title: "Harmless summary",
    task: "Summarize these notes in three bullets.",
    attachments: []
  });

  const markdown = renderTaskPacketMarkdown(packet);

  assert.match(markdown, /## Redactions\n- none$/m);
  assert.doesNotMatch(markdown, /## Redactions\n-\nn\no\nn\ne/m);
});
