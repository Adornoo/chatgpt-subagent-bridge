import test from "node:test";
import assert from "node:assert/strict";

import { assertSupportedRoutePlatform } from "../src/lib/chrome.ts";

test("assertSupportedRoutePlatform allows macOS route execution", () => {
  assert.doesNotThrow(() => assertSupportedRoutePlatform("darwin"));
});

test("assertSupportedRoutePlatform rejects non-macOS route execution", () => {
  assert.throws(
    () => assertSupportedRoutePlatform("linux"),
    /macOS|Apple Events|osascript/i
  );
});
