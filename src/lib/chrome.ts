import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BridgeTransportAdapter, BridgeTransportRequest, BridgeTransportResponse } from "./bridge.ts";

export interface ChromeAdapterOptions {
  chromeAppName?: string;
  chatGptUrl?: string;
  pollMs?: number;
  timeoutMs?: number;
}

const ALLOWED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

export function createChromeAppleScriptAdapter(
  options: ChromeAdapterOptions = {}
): BridgeTransportAdapter {
  assertSupportedRoutePlatform();
  const chromeAppName = options.chromeAppName ?? "Google Chrome";
  const chatGptUrl = options.chatGptUrl ?? "https://chatgpt.com/";
  const pollMs = options.pollMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180000;

  return {
    async sendAndCapture(request: BridgeTransportRequest): Promise<BridgeTransportResponse> {
      await focusChatGptTab(chromeAppName, chatGptUrl);
      await sleep(1200);

      const sendResult = await evaluateJson(chromeAppName, buildSendScript(request.prompt));
      if (sendResult.status !== "text-set") {
        throw new Error(`Chrome send failed: ${sendResult.reason ?? "unknown reason"}`);
      }

      const clickDeadline = Date.now() + 10000;
      let clicked = false;
      while (Date.now() < clickDeadline) {
        const clickResult = await evaluateJson(chromeAppName, buildClickSendScript());
        if (clickResult.status === "clicked") {
          clicked = true;
          break;
        }
        if (clickResult.status === "blocked") {
          throw new Error(`Chrome send blocked: ${clickResult.reason ?? "unknown reason"}`);
        }
        await sleep(500);
      }

      if (!clicked) {
        throw new Error("Chrome send failed: send button did not become clickable.");
      }

      let stableReads = 0;
      let previousText = "";
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await sleep(pollMs);
        const pollResult = await evaluateJson(chromeAppName, buildPollScript(request.prompt));

        if (pollResult.status === "blocked") {
          throw new Error(`Chrome capture blocked: ${pollResult.reason ?? "login or CAPTCHA required"}`);
        }

        if (pollResult.status === "ready" && typeof pollResult.text === "string" && pollResult.text.trim()) {
          const trimmed = pollResult.text.trim();
          stableReads = trimmed === previousText ? stableReads + 1 : 1;
          previousText = trimmed;

          if (stableReads >= 3) {
            return {
              responseText: trimmed,
              captureMeta: {
                channel: "chrome",
                capturedAt: new Date().toISOString(),
                source: pollResult.url
              }
            };
          }
        }
      }

      throw new Error("Chrome capture timed out before a stable ChatGPT response was detected.");
    }
  };
}

export function assertAllowedChatGptUrl(url: string, allowUnsafe = false): void {
  const parsed = new URL(url);
  const normalizedHost = parsed.hostname.toLowerCase();

  if (parsed.protocol === "https:" && ALLOWED_CHATGPT_HOSTS.has(normalizedHost)) {
    return;
  }

  if (allowUnsafe) {
    return;
  }

  throw new Error(
    "Refusing to route packet text to a non-ChatGPT URL. Use --allow-unsafe-chatgpt-url only for an explicit local test."
  );
}

export function assertSupportedRoutePlatform(platform = process.platform): void {
  if (platform === "darwin") {
    return;
  }

  throw new Error(
    "Live Chrome routing currently requires macOS, Google Chrome, and Apple Events automation via osascript. Use prepare, capture, or validate on other platforms."
  );
}

async function focusChatGptTab(chromeAppName: string, chatGptUrl: string): Promise<void> {
  await runAppleScript([
    `set targetUrl to ${appleString(chatGptUrl)}`,
    `tell ${appleApplicationTarget(chromeAppName)}`,
    "activate",
    "if (count of windows) is 0 then make new window",
    "tell front window",
    "make new tab at end of tabs with properties {URL: targetUrl}",
    "end tell",
    "end tell"
  ]);
}

async function evaluateJson(chromeAppName: string, javaScript: string): Promise<Record<string, unknown>> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "chatgpt-bridge-"));
  const scriptPath = join(tempDirectory, `${randomUUID()}.js`);

  try {
    await writeFile(scriptPath, `${javaScript.trim()}\n`, "utf8");
    const raw = await runAppleScript([
      `set scriptText to read POSIX file ${appleString(scriptPath)}`,
      `tell ${appleApplicationTarget(chromeAppName)}`,
      "set jsResult to execute active tab of front window javascript scriptText",
      "end tell",
      "return jsResult"
    ]);

    if (!raw) {
      throw new Error("Chrome returned an empty automation result.");
    }

    return JSON.parse(raw) as Record<string, unknown>;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function buildSendScript(prompt: string): string {
  return `
    (() => {
      const composer = document.querySelector("#prompt-textarea")
        ?? document.querySelector("textarea")
        ?? document.querySelector("div[contenteditable='true']");
      if (!composer) {
        return JSON.stringify({ status: "blocked", reason: "composer-not-found" });
      }

      const text = ${JSON.stringify(prompt)};

      const setText = (node, value) => {
        node.focus();
        if ("value" in node) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")?.set;
          if (setter) {
            setter.call(node, "");
          } else {
            node.value = "";
          }
          node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
          if (setter) {
            setter.call(node, value);
          } else {
            node.value = value;
          }
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }

        node.textContent = "";
        document.execCommand?.("insertText", false, value);
        if ((node.innerText || "").trim() !== value.trim()) {
          node.textContent = value;
        }
        node.dispatchEvent(new Event("input", { bubbles: true }));
      };

      setText(composer, text);
      return JSON.stringify({ status: "text-set" });
    })();
  `;
}

function buildClickSendScript(): string {
  return `
    (() => {
      const sendButton = document.querySelector("button[data-testid='send-button']")
        ?? [...document.querySelectorAll("button")].find((button) => {
          const label = (button.getAttribute("aria-label") || button.textContent || "").trim();
          return /send/i.test(label);
        });

      if (sendButton?.disabled) {
        return JSON.stringify({ status: "waiting", reason: "send-button-disabled" });
      }

      if (sendButton) {
        sendButton.scrollIntoView?.({ block: "center" });
        sendButton.click();
        return JSON.stringify({ status: "clicked" });
      }

      return JSON.stringify({ status: "blocked", reason: "send-button-not-found" });
    })();
  `;
}

function buildPollScript(sentPrompt: string): string {
  return `
    (() => {
      const sentPrompt = ${JSON.stringify(sentPrompt.trim())};
      const bodyText = document.body?.innerText || "";
      const blockedReason = /captcha|verify you are human/i.test(bodyText)
        ? "captcha"
        : ((/log in|sign up/i.test(bodyText.slice(0, 1500)) && !document.querySelector("#prompt-textarea") && !document.querySelector("textarea"))
          ? "login-required"
          : null);

      const stopVisible = [...document.querySelectorAll("button, [role='button']")].some((element) => {
        const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
        return /stop generating|stop streaming|stop$/i.test(label);
      });

      const assistantNodes = [...document.querySelectorAll("[data-message-author-role='assistant']")];
      const fallbackNodes = [
        ...document.querySelectorAll("main article"),
        ...document.querySelectorAll("[data-testid*='conversation-turn']")
      ];
      const candidates = assistantNodes.length > 0 ? assistantNodes : fallbackNodes;
      const texts = [];
      for (const node of candidates) {
        const text = (node.innerText || "").trim();
        if (text && text !== sentPrompt && !text.includes(sentPrompt) && !texts.includes(text)) {
          texts.push(text);
        }
      }

      const lastText = texts.at(-1) || "";
      return JSON.stringify({
        status: blockedReason ? "blocked" : (stopVisible || !lastText ? "waiting" : "ready"),
        reason: blockedReason,
        text: lastText,
        url: location.href
      });
    })();
  `;
}

async function runAppleScript(lines: string[]): Promise<string> {
  const args = lines.flatMap((line) => ["-e", line]);
  return new Promise((resolve, reject) => {
    execFile("osascript", args, (error, stdout, stderr) => {
      if (error) {
        const scriptPreview = lines.map((line, index) => `${index + 1}: ${line}`).join("\n");
        reject(new Error(normalizeAppleScriptError(`${stderr.trim() || error.message}\nAppleScript block:\n${scriptPreview}`)));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

function appleString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function appleApplicationTarget(chromeAppName: string): string {
  return chromeAppName === "Google Chrome"
    ? "application id \"com.google.Chrome\""
    : `application ${appleString(chromeAppName)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeAppleScriptError(message: string): string {
  if (/Allow JavaScript from Apple Events|Executing JavaScript through AppleScript is turned off/i.test(message)) {
    return "Chrome blocked automation because 'Allow JavaScript from Apple Events' is disabled in View > Developer.";
  }

  if (/Access not allowed/i.test(message)) {
    return "Chrome blocked automation with 'Access not allowed'. The preference may be enabled, but the currently running Chrome app still needs a restart or a manual toggle of View > Developer > Allow JavaScript from Apple Events.";
  }

  if (/Can.?t get application id "com\.google\.Chrome"/i.test(message)) {
    return "Google Chrome is not available to AppleScript on this Mac. Make sure Google Chrome is installed and can be opened normally before running a live bridge route.";
  }

  return message;
}
