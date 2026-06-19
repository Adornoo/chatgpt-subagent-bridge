import test from "node:test";
import assert from "node:assert/strict";

import { assertAllowedChatGptUrl, normalizeAppleScriptError } from "../src/lib/chrome.ts";

test("normalizeAppleScriptError explains the disabled Apple Events setting", () => {
  const message = normalizeAppleScriptError(
    "Google Chrome got an error: Executing JavaScript through AppleScript is turned off."
  );

  assert.match(message, /Allow JavaScript from Apple Events/i);
  assert.match(message, /disabled/i);
});

test("normalizeAppleScriptError explains Access not allowed as a running-Chrome state issue", () => {
  const message = normalizeAppleScriptError("Google Chrome got an error: Access not allowed. (-1723)");

  assert.match(message, /Access not allowed/i);
  assert.match(message, /restart Chrome|running Chrome/i);
  assert.match(message, /Allow JavaScript from Apple Events/i);
});

test("normalizeAppleScriptError explains when Google Chrome is unavailable to AppleScript", () => {
  const message = normalizeAppleScriptError(
    '68:79: Can’t get application id "com.google.Chrome". (-1728)'
  );

  assert.match(message, /Google Chrome/i);
  assert.match(message, /not installed|not available|unavailable/i);
  assert.match(message, /AppleScript/i);
});

test("assertAllowedChatGptUrl allows the expected ChatGPT hosts", () => {
  assert.doesNotThrow(() => assertAllowedChatGptUrl("https://chatgpt.com/"));
  assert.doesNotThrow(() => assertAllowedChatGptUrl("https://chat.openai.com/"));
});

test("assertAllowedChatGptUrl blocks non-ChatGPT destinations unless explicitly allowed", () => {
  assert.throws(() => assertAllowedChatGptUrl("https://example.com/"), /non-ChatGPT URL/i);
  assert.doesNotThrow(() => assertAllowedChatGptUrl("https://example.com/", true));
});
