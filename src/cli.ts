#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  captureResultForPacket,
  completeDeepResearchThroughBridge,
  loadTaskPacket,
  prepareTaskPacket,
  renderTaskPacketMarkdown,
  routeTaskThroughBridge,
  startDeepResearchThroughBridge,
  validateCapturedResult
} from "./lib/bridge.ts";
import type { WorkMode } from "./lib/bridge.ts";
import { assertAllowedChatGptUrl, createChromeAppleScriptAdapter, createChromeDeepResearchAdapter } from "./lib/chrome.ts";

type ParsedArgs = {
  positionals: string[];
  values: Map<string, string[]>;
};

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];

  switch (command) {
    case "prepare":
      return runPrepare(parsed);
    case "route":
      return runRoute(parsed);
    case "research-start":
      return runResearchStart(parsed);
    case "research-complete":
      return runResearchComplete(parsed);
    case "capture":
      return runCapture(parsed);
    case "validate":
      return runValidate(parsed);
    case "help":
    case undefined:
      printHelp();
      return 0;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runPrepare(parsed: ParsedArgs): Promise<number> {
  const packet = await buildPacketFromArgs(parsed);
  console.log(renderTaskPacketMarkdown(packet));
  return 0;
}

async function runRoute(parsed: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(singleValue(parsed, "workspace-root") ?? process.cwd());
  const packet = await buildPacketFromArgs(parsed);
  const chatGptUrl = singleValue(parsed, "chatgpt-url") ?? "https://chatgpt.com/";
  assertAllowedChatGptUrl(chatGptUrl, hasFlag(parsed, "allow-unsafe-chatgpt-url"));
  const result = await routeTaskThroughBridge({
    workspaceRoot,
    packet,
    adapter: createChromeAppleScriptAdapter({
      chatGptUrl,
      pollMs: parseNumber(singleValue(parsed, "poll-ms")) ?? 2000,
      timeoutMs: parseNumber(singleValue(parsed, "timeout-ms")) ?? 180000
    }),
    confirmSensitive: hasFlag(parsed, "confirm-sensitive")
  });

  console.log(
    JSON.stringify(
      {
        runDirectory: result.runDirectory,
        verdict: result.verdict.status,
        reasons: result.verdict.reasons
      },
      null,
      2
    )
  );

  return exitCodeForVerdict(result.verdict.status, parsed);
}

async function runResearchStart(parsed: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(singleValue(parsed, "workspace-root") ?? process.cwd());
  const packet = await buildPacketFromArgs(parsed, "deep-research-report");
  const chatGptUrl = singleValue(parsed, "chatgpt-url") ?? "https://chatgpt.com/";
  assertAllowedChatGptUrl(chatGptUrl, hasFlag(parsed, "allow-unsafe-chatgpt-url"));
  const result = await startDeepResearchThroughBridge({
    workspaceRoot,
    packet,
    adapter: createChromeDeepResearchAdapter({
      chatGptUrl,
      pollMs: parseNumber(singleValue(parsed, "poll-ms")) ?? 2000,
      timeoutMs: parseNumber(singleValue(parsed, "timeout-ms")) ?? 300000
    }),
    confirmSensitive: hasFlag(parsed, "confirm-sensitive")
  });

  console.log(
    JSON.stringify(
      {
        runDirectory: result.runDirectory,
        approachPath: result.approachPath,
        approachChars: result.approachText.length,
        next: "Review research-approach.md, then run research-complete with optional --approach-feedback."
      },
      null,
      2
    )
  );

  return 0;
}

async function runResearchComplete(parsed: ParsedArgs): Promise<number> {
  const runDirectory = resolve(requiredValue(parsed, "run-directory"));
  const packet = await loadTaskPacket(join(runDirectory, "task-packet.json"));
  const chatGptUrl = singleValue(parsed, "chatgpt-url") ?? "https://chatgpt.com/";
  assertAllowedChatGptUrl(chatGptUrl, hasFlag(parsed, "allow-unsafe-chatgpt-url"));
  const result = await completeDeepResearchThroughBridge({
    runDirectory,
    packet,
    approachFeedback: await resolveOptionalText(parsed, "approach-feedback", "approach-feedback-file"),
    adapter: createChromeDeepResearchAdapter({
      chatGptUrl,
      pollMs: parseNumber(singleValue(parsed, "poll-ms")) ?? 900000,
      timeoutMs: parseNumber(singleValue(parsed, "timeout-ms")) ?? 28800000
    })
  });

  console.log(
    JSON.stringify(
      {
        runDirectory: result.runDirectory,
        resultPacketPath: result.resultPacketPath,
        verdict: result.verdict.status,
        reasons: result.verdict.reasons
      },
      null,
      2
    )
  );

  return exitCodeForVerdict(result.verdict.status, parsed);
}

async function runCapture(parsed: ParsedArgs): Promise<number> {
  const packet = await loadTaskPacket(requiredValue(parsed, "packet"));
  const responseText = await resolveResponseText(parsed);
  const runDirectory = resolve(singleValue(parsed, "run-directory") ?? dirnameFromPacket(requiredValue(parsed, "packet")));
  const captured = await captureResultForPacket({
    packet,
    responseText,
    runDirectory,
    captureMeta: {
      channel: singleValue(parsed, "channel") ?? "manual",
      source: singleValue(parsed, "source")
    }
  });

  console.log(
    JSON.stringify(
      {
        verdict: captured.verdict.status,
        reasons: captured.verdict.reasons
      },
      null,
      2
    )
  );

  return exitCodeForVerdict(captured.verdict.status, parsed);
}

async function runValidate(parsed: ParsedArgs): Promise<number> {
  const packet = await loadTaskPacket(requiredValue(parsed, "packet"));
  const responseText = await resolveResponseText(parsed);
  const verdict = validateCapturedResult({
    packet,
    responseText
  });
  console.log(JSON.stringify(verdict, null, 2));
  return exitCodeForVerdict(verdict.status, parsed);
}

async function buildPacketFromArgs(parsed: ParsedArgs, defaultWorkMode: WorkMode = "advice-only") {
  const task = await resolveTaskText(parsed);
  const attachments = await resolveAttachments(parsed);
  const workMode = parseWorkMode(singleValue(parsed, "mode"), defaultWorkMode);
  return prepareTaskPacket({
    title: requiredValue(parsed, "title"),
    task,
    attachments,
    workMode,
    maxResponseChars: parseNumber(singleValue(parsed, "max-response-chars"))
  });
}

async function resolveOptionalText(
  parsed: ParsedArgs,
  directKey: string,
  fileKey: string
): Promise<string | undefined> {
  const direct = singleValue(parsed, directKey);
  if (direct) {
    return direct;
  }

  const file = singleValue(parsed, fileKey);
  if (!file) {
    return undefined;
  }

  return readFile(resolve(file), "utf8");
}

async function resolveTaskText(parsed: ParsedArgs): Promise<string> {
  const direct = singleValue(parsed, "task");
  if (direct) {
    return direct;
  }

  const taskFile = singleValue(parsed, "task-file");
  if (!taskFile) {
    throw new Error("Provide --task or --task-file.");
  }

  return readFile(resolve(taskFile), "utf8");
}

async function resolveResponseText(parsed: ParsedArgs): Promise<string> {
  const direct = singleValue(parsed, "response");
  if (direct) {
    return direct;
  }

  const responseFile = singleValue(parsed, "response-file");
  if (!responseFile) {
    throw new Error("Provide --response or --response-file.");
  }

  return readFile(resolve(responseFile), "utf8");
}

async function resolveAttachments(parsed: ParsedArgs) {
  const rawAttachments = parsed.values.get("attachment") ?? [];
  const attachments = [];

  for (const entry of rawAttachments) {
    const [label, ...pathParts] = entry.split("=");
    const filePath = pathParts.join("=");
    if (!label || !filePath) {
      throw new Error(`Invalid attachment format: ${entry}. Use --attachment label=/path/to/file.`);
    }

    attachments.push({
      label,
      content: await readFile(resolve(filePath), "utf8")
    });
  }

  return attachments;
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(name, [...(values.get(name) ?? []), "true"]);
      continue;
    }

    values.set(name, [...(values.get(name) ?? []), next]);
    index += 1;
  }

  return { positionals, values };
}

function singleValue(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.values.get(key)?.at(-1);
}

function requiredValue(parsed: ParsedArgs, key: string): string {
  const value = singleValue(parsed, key);
  if (!value) {
    throw new Error(`Missing required argument: --${key}`);
  }
  return value;
}

function hasFlag(parsed: ParsedArgs, key: string): boolean {
  return singleValue(parsed, key) === "true";
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseWorkMode(value: string | undefined, defaultWorkMode: WorkMode = "advice-only"): WorkMode {
  if (!value) {
    return defaultWorkMode;
  }

  if (
    value === "advice-only" ||
    value === "github-only-code" ||
    value === "deep-research-brief" ||
    value === "deep-research-report"
  ) {
    return value;
  }

  throw new Error(
    `Unknown mode: ${value}. Expected advice-only, github-only-code, deep-research-brief, or deep-research-report.`
  );
}

function exitCodeForVerdict(status: "pass" | "fail", parsed: ParsedArgs): number {
  if (status === "pass" || hasFlag(parsed, "allow-failed-verdict")) {
    return 0;
  }

  return 2;
}

function dirnameFromPacket(packetPath: string): string {
  const normalized = resolve(packetPath);
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function printHelp(): void {
  console.log(`
chatgpt-subagent-bridge

MIT-licensed packet-only bridge for attended drafting, summarizing, planning, and review-style handoffs.

Do not use this for secrets, regulated data, or anything you would not be willing to send to ChatGPT itself.

Commands:
  prepare --title TITLE --task TEXT [--mode advice-only|github-only-code|deep-research-brief|deep-research-report]
  route --title TITLE --task TEXT [--mode advice-only|github-only-code|deep-research-brief|deep-research-report] [--workspace-root DIR] [--confirm-sensitive] [--allow-failed-verdict]
  research-start --title TITLE --task TEXT [--workspace-root DIR] [--confirm-sensitive]
  research-complete --run-directory DIR [--approach-feedback TEXT|--approach-feedback-file FILE] [--poll-ms 900000] [--timeout-ms 28800000]
  capture --packet FILE --response TEXT|--response-file FILE [--run-directory DIR] [--allow-failed-verdict]
  validate --packet FILE --response TEXT|--response-file FILE [--allow-failed-verdict]

Notes:
  route writes bridge_runs/ under the selected workspace root.
  research-start opens a new ChatGPT chat, requests Deep Research, and stores ChatGPT's proposed research approach without confirming it.
  research-complete can send approach feedback, confirms the research run, and polls until the final report is ready.
  Deep Research artifact views are captured through ChatGPT's Export to Markdown action when direct page-text capture is unavailable.
  If --workspace-root is omitted, route defaults to the current working directory.
  Examples use fake paths and sample data only.

Examples:
  chatgpt-bridge prepare --title "Summarize notes" --task "Summarize these notes in three bullets."
  chatgpt-bridge prepare --title "Market map brief" --mode deep-research-brief --task "Plan a source-bound research brief."
  chatgpt-bridge route --title "Summarize notes" --task "Summarize these notes in three bullets." --workspace-root .
  chatgpt-bridge research-start --title "Subscription usage research" --task-file ./research-plan.md --workspace-root .
  chatgpt-bridge research-complete --run-directory ./bridge_runs/... --poll-ms 900000
  chatgpt-bridge capture --packet ./bridge_runs/.../task-packet.json --response-file ./reply.txt --run-directory ./bridge_runs/.../
  chatgpt-bridge validate --packet ./bridge_runs/.../task-packet.json --response-file ./reply.txt
  `);
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
