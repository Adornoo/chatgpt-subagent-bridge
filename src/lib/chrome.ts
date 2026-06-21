import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BridgeTransportAdapter,
  BridgeTransportRequest,
  BridgeTransportResponse,
  DeepResearchApproachRequest,
  DeepResearchApproachResponse,
  DeepResearchReportRequest,
  DeepResearchTransportAdapter
} from "./bridge.ts";

export interface ChromeAdapterOptions {
  chromeAppName?: string;
  chatGptUrl?: string;
  pollMs?: number;
  timeoutMs?: number;
  downloadDirectory?: string;
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

export function createChromeDeepResearchAdapter(
  options: ChromeAdapterOptions = {}
): DeepResearchTransportAdapter {
  assertSupportedRoutePlatform();
  const chromeAppName = options.chromeAppName ?? "Google Chrome";
  const chatGptUrl = options.chatGptUrl ?? "https://chatgpt.com/";
  const pollMs = options.pollMs ?? 900000;
  const timeoutMs = options.timeoutMs ?? 28800000;
  const downloadDirectory = options.downloadDirectory ?? join(homedir(), "Downloads");

  return {
    async submitResearchPlan(request: BridgeTransportRequest): Promise<DeepResearchApproachResponse> {
      await focusChatGptTab(chromeAppName, chatGptUrl);
      await sleep(1200);

      const activation = await activateDeepResearch(chromeAppName);
      const prompt = activation
        ? request.prompt
        : `/Deepresearch\n\n${request.prompt}`;
      await sendPromptAndClick(chromeAppName, prompt);
      return waitForDeepResearchApproach(chromeAppName, downloadDirectory, prompt, Math.min(pollMs, 5000), timeoutMs);
    },

    async reviseResearchApproach(request: DeepResearchApproachRequest): Promise<DeepResearchApproachResponse> {
      if (!request.feedback?.trim()) {
        throw new Error("Approach feedback is empty.");
      }

      await sendPromptAndClick(chromeAppName, request.feedback.trim());
      return waitForDeepResearchApproach(
        chromeAppName,
        downloadDirectory,
        request.feedback.trim(),
        Math.min(pollMs, 5000),
        timeoutMs
      );
    },

    async requestResearchReport(request: DeepResearchReportRequest): Promise<BridgeTransportResponse> {
      const confirmPrompt = [
        "Confirmed. Proceed now with the full source-cited Markdown report exactly as specified in the original brief.",
        "Keep the answer focused on the original task packet and include practical caveats where the published limits are imprecise."
      ].join("\n");
      await confirmDeepResearchReport(chromeAppName, confirmPrompt);

      let stableReads = 0;
      let previousText = "";
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await sleep(pollMs);
        const pollResult = await evaluateJson(chromeAppName, buildPollDeepResearchReportScript(request.prompt));

        if (pollResult.status === "blocked") {
          throw new Error(`Deep Research capture blocked: ${pollResult.reason ?? "login or CAPTCHA required"}`);
        }

        if (pollResult.status === "ready-export") {
          const exported = await exportDeepResearchMarkdown(chromeAppName, downloadDirectory);
          return {
            responseText: exported.text,
            captureMeta: {
              channel: "chrome",
              capturedAt: new Date().toISOString(),
              source: pollResult.url,
              notes: `Captured via ChatGPT Markdown export from ${exported.path}.`
            }
          };
        }

        if (pollResult.status === "ready" && typeof pollResult.text === "string" && pollResult.text.trim()) {
          const trimmed = pollResult.text.trim();
          stableReads = trimmed === previousText ? stableReads + 1 : 1;
          previousText = trimmed;

          if (stableReads >= 2) {
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

      throw new Error("Deep Research capture timed out before a stable final report was detected.");
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

async function sendPromptAndClick(chromeAppName: string, prompt: string): Promise<void> {
  const sendResult = await evaluateJson(chromeAppName, buildSendScript(prompt));
  if (sendResult.status !== "text-set") {
    throw new Error(`Chrome send failed: ${sendResult.reason ?? "unknown reason"}`);
  }

  const clickDeadline = Date.now() + 10000;
  while (Date.now() < clickDeadline) {
    const clickResult = await evaluateJson(chromeAppName, buildClickSendScript());
    if (clickResult.status === "clicked") {
      return;
    }
    if (clickResult.status === "blocked") {
      throw new Error(`Chrome send blocked: ${clickResult.reason ?? "unknown reason"}`);
    }
    await sleep(500);
  }

  throw new Error("Chrome send failed: send button did not become clickable.");
}

async function activateDeepResearch(chromeAppName: string): Promise<boolean> {
  const deadline = Date.now() + 6000;

  while (Date.now() < deadline) {
    const result = await evaluateJson(chromeAppName, buildActivateDeepResearchScript());
    if (result.status === "activated") {
      return true;
    }
    if (result.status === "blocked") {
      throw new Error(`Deep Research activation blocked: ${result.reason ?? "unknown reason"}`);
    }
    await sleep(500);
  }

  return false;
}

async function waitForDeepResearchApproach(
  chromeAppName: string,
  downloadDirectory: string,
  sentPrompt: string,
  pollMs: number,
  timeoutMs: number
): Promise<DeepResearchApproachResponse> {
  const deadline = Date.now() + timeoutMs;
  let stableReads = 0;
  let previousText = "";

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const pollResult = await evaluateJson(chromeAppName, buildPollDeepResearchApproachScript(sentPrompt));

    if (pollResult.status === "blocked") {
      throw new Error(`Deep Research approach capture blocked: ${pollResult.reason ?? "login or CAPTCHA required"}`);
    }

    if (pollResult.status === "ready-export") {
      const exported = await exportDeepResearchMarkdown(chromeAppName, downloadDirectory);
      return {
        approachText: exported.text,
        captureMeta: {
          channel: "chrome",
          capturedAt: new Date().toISOString(),
          source: pollResult.url,
          notes: `Captured via ChatGPT Markdown export from ${exported.path}.`
        }
      };
    }

    if (pollResult.status === "ready" && typeof pollResult.text === "string" && pollResult.text.trim()) {
      const trimmed = pollResult.text.trim();
      stableReads = trimmed === previousText ? stableReads + 1 : 1;
      previousText = trimmed;

      if (stableReads >= 2) {
        return {
          approachText: trimmed,
          captureMeta: {
            channel: "chrome",
            capturedAt: new Date().toISOString(),
            source: pollResult.url
          }
        };
      }
    }
  }

  throw new Error("Deep Research approach capture timed out before a confirmation approach was detected.");
}

async function confirmDeepResearchReport(chromeAppName: string, confirmPrompt: string): Promise<void> {
  const initialClick = await clickDeepResearchConfirm(chromeAppName, 15000);
  if (initialClick) {
    return;
  }

  await sendPromptAndClick(chromeAppName, confirmPrompt);
  const secondClick = await clickDeepResearchConfirm(chromeAppName, 30000);
  if (!secondClick) {
    throw new Error("Deep Research confirmation failed: confirmation button did not become clickable.");
  }
}

async function clickDeepResearchConfirm(chromeAppName: string, timeoutMs: number): Promise<boolean> {
  const clickDeadline = Date.now() + timeoutMs;

  while (Date.now() < clickDeadline) {
    const clickResult = await evaluateJson(chromeAppName, buildClickDeepResearchConfirmScript());
    if (clickResult.status === "clicked") {
      return true;
    }
    if (clickResult.status === "blocked") {
      throw new Error(`Deep Research confirmation blocked: ${clickResult.reason ?? "unknown reason"}`);
    }
    await sleep(500);
  }

  return false;
}

async function exportDeepResearchMarkdown(
  chromeAppName: string,
  downloadDirectory: string
): Promise<{ text: string; path: string }> {
  const exportStartedAt = Date.now();
  const openResult = await evaluateJson(chromeAppName, buildClickExportButtonScript());
  if (openResult.status !== "clicked" && openResult.status !== "already-open") {
    throw new Error(`Deep Research export failed: ${openResult.reason ?? "export button not found"}`);
  }

  const clickDeadline = Date.now() + 10000;
  let markdownClicked = false;
  while (Date.now() < clickDeadline) {
    const clickResult = await evaluateJson(chromeAppName, buildClickExportMarkdownScript());
    if (clickResult.status === "clicked") {
      markdownClicked = true;
      break;
    }
    if (clickResult.status === "blocked") {
      throw new Error(`Deep Research Markdown export blocked: ${clickResult.reason ?? "unknown reason"}`);
    }
    await sleep(500);
  }

  if (!markdownClicked) {
    throw new Error("Deep Research export failed: Markdown export option did not become clickable.");
  }

  const markdownPath = await waitForLatestMarkdownDownload(downloadDirectory, exportStartedAt, 30000);
  return {
    text: await readFile(markdownPath, "utf8"),
    path: markdownPath
  };
}

async function waitForLatestMarkdownDownload(
  downloadDirectory: string,
  sinceMs: number,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let previousPath = "";
  let previousSize = -1;

  while (Date.now() < deadline) {
    const candidate = await findLatestMarkdownDownload(downloadDirectory, sinceMs);
    if (candidate) {
      const fileStat = await stat(candidate);
      if (candidate === previousPath && fileStat.size === previousSize && fileStat.size > 0) {
        return candidate;
      }
      previousPath = candidate;
      previousSize = fileStat.size;
    }
    await sleep(500);
  }

  throw new Error(`Deep Research export failed: no stable Markdown download appeared in ${downloadDirectory}.`);
}

export async function findLatestMarkdownDownload(
  downloadDirectory: string,
  sinceMs: number
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(downloadDirectory);
  } catch {
    return null;
  }

  let latest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!/\.md$/i.test(entry) || /\.crdownload$/i.test(entry)) {
      continue;
    }

    const path = join(downloadDirectory, entry);
    const fileStat = await stat(path);
    if (!fileStat.isFile() || fileStat.mtimeMs < sinceMs) {
      continue;
    }

    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = {
        path,
        mtimeMs: fileStat.mtimeMs
      };
    }
  }

  return latest?.path ?? null;
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

function buildActivateDeepResearchScript(): string {
  return `
    (() => {
      const bodyText = document.body?.innerText || "";
      if (/captcha|verify you are human/i.test(bodyText)) {
        return JSON.stringify({ status: "blocked", reason: "captcha" });
      }

      const elements = [...document.querySelectorAll("button, [role='button'], [role='menuitem'], [role='menuitemradio'], a")];
      const selectedDeepResearch = elements.find((element) => {
        const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
        return /deep\\s*research/i.test(label) && /click\\s+to\\s+remove|selected/i.test(label);
      });

      if (selectedDeepResearch) {
        return JSON.stringify({ status: "activated", reason: "already-selected" });
      }

      const deepResearch = elements.find((element) => {
        const role = element.getAttribute?.("role") || "";
        const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
        return /menuitemradio|menuitem/i.test(role) && /^deep\\s*research$/i.test(label);
      });

      if (deepResearch) {
        deepResearch.scrollIntoView?.({ block: "center" });
        clickLikeUser(deepResearch);
        return JSON.stringify({ status: "activated" });
      }

      const tools = elements.find((element) => {
        const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
        return /^add\\s+files\\s+and\\s+more$/i.test(label);
      });

      if (tools) {
        clickLikeUser(tools);
        return JSON.stringify({ status: "waiting", reason: "opened-tool-menu" });
      }

      return JSON.stringify({ status: "waiting", reason: "deep-research-control-not-found" });

      function clickLikeUser(element) {
        element.scrollIntoView?.({ block: "center" });
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
      }
    })();
  `;
}

function buildPollDeepResearchApproachScript(sentPrompt: string): string {
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

      const confirmVisible = findDeepResearchConfirmButton() !== null;
      const exportVisible = findExportButton() !== null;
      const text = latestAssistantText(sentPrompt);

      return JSON.stringify({
        status: blockedReason
          ? "blocked"
          : (exportVisible && !stopVisible
            ? "ready-export"
            : (confirmVisible && text && !stopVisible ? "ready" : "waiting")),
        reason: blockedReason,
        text,
        url: location.href
      });

      function latestAssistantText(promptText) {
        const assistantNodes = [...document.querySelectorAll("[data-message-author-role='assistant']")];
        const fallbackNodes = [
          ...document.querySelectorAll("main article"),
          ...document.querySelectorAll("[data-testid*='conversation-turn']")
        ];
        const candidates = assistantNodes.length > 0 ? assistantNodes : fallbackNodes;
        const texts = [];
        for (const node of candidates) {
          const candidate = (node.innerText || "").trim();
          if (candidate && candidate !== promptText && !candidate.includes(promptText) && !texts.includes(candidate)) {
            texts.push(candidate);
          }
        }
        return texts.at(-1) || "";
      }

      function findDeepResearchConfirmButton() {
        const buttons = [...document.querySelectorAll("button, [role='button']")];
        return buttons.find((button) => {
          if (button.disabled || button.getAttribute?.("aria-disabled") === "true") {
            return false;
          }
          const label = (button.getAttribute?.("aria-label") || button.textContent || "").trim();
          return /\\bstart\\b|start\\s+research|begin\\s+research|run\\s+research|confirm|start\\s+report|create\\s+report/i.test(label);
        }) || null;
      }

      function findExportButton() {
        const buttons = [...document.querySelectorAll("button, [role='button']")];
        return buttons.find((button) => {
          if (button.disabled || button.getAttribute?.("aria-disabled") === "true") {
            return false;
          }
          const label = (button.getAttribute?.("aria-label") || button.textContent || "").trim();
          return /^export$/i.test(label);
        }) || null;
      }
    })();
  `;
}

function buildClickDeepResearchConfirmScript(): string {
  return `
    (() => {
      const bodyText = document.body?.innerText || "";
      if (/captcha|verify you are human/i.test(bodyText)) {
        return JSON.stringify({ status: "blocked", reason: "captcha" });
      }

      const buttons = [...document.querySelectorAll("button, [role='button']")];
      const button = buttons.find((candidate) => {
        if (candidate.disabled || candidate.getAttribute?.("aria-disabled") === "true") {
          return false;
        }
        const label = (candidate.getAttribute?.("aria-label") || candidate.textContent || "").trim();
        return /\\bstart\\b|start\\s+research|begin\\s+research|run\\s+research|confirm|start\\s+report|create\\s+report/i.test(label);
      });

      if (!button) {
        return JSON.stringify({ status: "waiting", reason: "confirm-button-not-found" });
      }

      button.scrollIntoView?.({ block: "center" });
      button.click();
      return JSON.stringify({ status: "clicked" });
    })();
  `;
}

function buildPollDeepResearchReportScript(sentPrompt: string): string {
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
        return /stop research|stop generating|stop streaming|stop$/i.test(label);
      });
      const runningTextVisible = /researching|searching|reading sources|analyzing sources|working on|still working/i.test(bodyText);
      const exportVisible = findExportButton() !== null;
      const text = latestAssistantText(sentPrompt);

      return JSON.stringify({
        status: blockedReason
          ? "blocked"
          : (exportVisible && !stopVisible
            ? "ready-export"
            : ((stopVisible || runningTextVisible || !text) ? "waiting" : "ready")),
        reason: blockedReason,
        text,
        url: location.href
      });

      function latestAssistantText(promptText) {
        const assistantNodes = [...document.querySelectorAll("[data-message-author-role='assistant']")];
        const fallbackNodes = [
          ...document.querySelectorAll("main article"),
          ...document.querySelectorAll("[data-testid*='conversation-turn']")
        ];
        const candidates = assistantNodes.length > 0 ? assistantNodes : fallbackNodes;
        const texts = [];
        for (const node of candidates) {
          const candidate = (node.innerText || "").trim();
          if (candidate && candidate !== promptText && !candidate.includes(promptText) && !texts.includes(candidate)) {
            texts.push(candidate);
          }
        }
        return texts.at(-1) || "";
      }

      function findExportButton() {
        const buttons = [...document.querySelectorAll("button, [role='button']")];
        return buttons.find((button) => {
          if (button.disabled || button.getAttribute?.("aria-disabled") === "true") {
            return false;
          }
          const label = (button.getAttribute?.("aria-label") || button.textContent || "").trim();
          return /^export$/i.test(label);
        }) || null;
      }
    })();
  `;
}

function buildClickExportButtonScript(): string {
  return `
    (() => {
      const bodyText = document.body?.innerText || "";
      if (/captcha|verify you are human/i.test(bodyText)) {
        return JSON.stringify({ status: "blocked", reason: "captcha" });
      }

      const markdownOption = findByLabel("Export to Markdown");
      if (markdownOption) {
        return JSON.stringify({ status: "already-open" });
      }

      const exportButton = findByLabel("Export");
      if (!exportButton) {
        return JSON.stringify({ status: "waiting", reason: "export-button-not-found" });
      }

      clickLikeUser(exportButton);
      return JSON.stringify({ status: "clicked" });

      function findByLabel(expected) {
        const elements = [...document.querySelectorAll("button, [role='button'], [role='menuitem'], [role='menuitemradio']")];
        return elements.find((element) => {
          if (element.disabled || element.getAttribute?.("aria-disabled") === "true") {
            return false;
          }
          const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
          return label.toLowerCase() === expected.toLowerCase();
        }) || null;
      }

      function clickLikeUser(element) {
        element.scrollIntoView?.({ block: "center" });
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
      }
    })();
  `;
}

function buildClickExportMarkdownScript(): string {
  return `
    (() => {
      const bodyText = document.body?.innerText || "";
      if (/captcha|verify you are human/i.test(bodyText)) {
        return JSON.stringify({ status: "blocked", reason: "captcha" });
      }

      const elements = [...document.querySelectorAll("button, [role='button'], [role='menuitem'], [role='menuitemradio']")];
      const markdownOption = elements.find((element) => {
        if (element.disabled || element.getAttribute?.("aria-disabled") === "true") {
          return false;
        }
        const label = (element.getAttribute?.("aria-label") || element.textContent || "").trim();
        return /^export\\s+to\\s+markdown$/i.test(label);
      });

      if (!markdownOption) {
        return JSON.stringify({ status: "waiting", reason: "markdown-export-option-not-found" });
      }

      markdownOption.scrollIntoView?.({ block: "center" });
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        markdownOption.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return JSON.stringify({ status: "clicked" });
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
