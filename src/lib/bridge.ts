import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  CaptureMeta,
  DeliveryPolicy,
  ResultPacket,
  RiskAssessment,
  TaskAttachment,
  TaskPacket,
  ValidationVerdict
} from "./schema.ts";

export interface PrepareTaskPacketInput {
  title: string;
  task: string;
  attachments: TaskAttachment[];
  workMode?: "advice-only" | "github-only-code";
  maxResponseChars?: number;
}

export interface BridgeTransportRequest {
  packet: PreparedTaskPacket;
  prompt: string;
  runDirectory: string;
}

export interface BridgeTransportResponse {
  responseText: string;
  captureMeta?: Partial<CaptureMeta>;
}

export interface BridgeTransportAdapter {
  sendAndCapture(request: BridgeTransportRequest): Promise<BridgeTransportResponse>;
}

export interface RouteTaskOptions {
  workspaceRoot: string;
  packet: PreparedTaskPacket;
  adapter: BridgeTransportAdapter;
  confirmSensitive?: boolean;
}

export interface CaptureStoredResultOptions {
  packet: PreparedTaskPacket;
  responseText: string;
  runDirectory: string;
  captureMeta?: Partial<CaptureMeta>;
}

export interface RouteTaskResult {
  runDirectory: string;
  taskPacketPath: string;
  taskMarkdownPath: string;
  resultPacketPath: string;
  verdictPath: string;
  resultPacket: StoredResultPacket;
  verdict: ValidationVerdict;
}

export type PreparedTaskPacket = TaskPacket & {
  delivery: DeliveryPolicy;
};

export type StoredResultPacket = ResultPacket & {
  capture: CaptureMeta;
};

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|bearer token|secret)\s*[:=]\s*[^\s,;]+/gi
];

const BLOCKED_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\baws_secret_access_key\b/gi
];

const LOCAL_PATH_PATTERNS = [
  /\/Users\/[^\s"'`]+/g,
  /~\/[^\s"'`]+/g,
  /\b[A-Z]:\\[^\s"'`]+/g
];

const LOCAL_ENDPOINT_PATTERNS = [
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s)"]*/gi,
  /\bhttps?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?[^\s)"]*/gi,
  /\bhttps?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?[^\s)"]*/gi,
  /\bhttps?:\/\/172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(?::\d+)?[^\s)"]*/gi
];

const PERSONAL_DATA_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g
];

const SENSITIVE_TOPIC_PATTERNS = [
  /\bpayroll\b/i,
  /\bmedical\b/i,
  /\bpatient\b/i,
  /\bbank\b/i,
  /\bpassport\b/i,
  /\bssn\b/i,
  /\blegal\b/i
];

const EXECUTION_CLAIM_PATTERNS = [
  /\b(?:i|we)\s+(?:opened|read|accessed|edited|modified|changed|patched|updated)\b[^.\n]{0,80}\b(?:local|workspace|file|filesystem|repo|repository)\b/i,
  /\b(?:i|we)\s+(?:ran|executed|tested|launched)\b[^.\n]{0,80}\b(?:locally|local|shell|terminal|tests|command|repo|workspace)\b/i,
  /\b(?:i|we)\s+(?:committed|pushed|merged)\b/i
];

const LEAK_PATTERNS = [
  /\/Users\/[^\s"'`]+/i,
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1]))[^\s)"]*/i,
  /\bsk-[A-Za-z0-9_-]{6,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/i
];

export function prepareTaskPacket(input: PrepareTaskPacketInput): PreparedTaskPacket {
  const packetId = randomUUID();
  const createdAt = new Date().toISOString();
  const combinedItems = [input.task, ...input.attachments.map((attachment) => attachment.content)];
  const combinedText = combinedItems.join("\n\n");

  const redactionItems: TaskPacket["redaction"]["items"] = [];
  const redactedTask = redactText(input.task, redactionItems);
  const redactedAttachments = input.attachments.map((attachment) => ({
    ...attachment,
    content: redactText(attachment.content, redactionItems)
  }));

  const risk = assessRisk({
    combinedText,
    redactionItems,
    attachmentCount: redactedAttachments.length
  });
  const deliveryPolicy = buildDeliveryPolicy(risk, input.maxResponseChars ?? 8000);

  const promptBody = buildPromptBody({
    title: input.title,
    task: redactedTask,
    attachments: redactedAttachments,
    workMode: input.workMode ?? "advice-only",
    maxResponseChars: deliveryPolicy.maxResponseChars ?? 8000
  });

  return {
    schemaVersion: "0.1",
    kind: "task",
    id: packetId,
    prompt: {
      title: input.title,
      body: promptBody,
      attachments: redactedAttachments
    },
    redaction: {
      items: redactionItems
    },
    risk,
    deliveryPolicy,
    delivery: deliveryPolicy,
    captureMeta: {
      channel: "chrome",
      capturedAt: createdAt,
      source: "chatgpt.com"
    }
  };
}

export async function routeTaskThroughBridge(options: RouteTaskOptions): Promise<RouteTaskResult> {
  const { workspaceRoot, packet, adapter, confirmSensitive = false } = options;
  enforceDeliveryPolicy(packet, confirmSensitive);

  const runDirectory = await createRunDirectory(workspaceRoot, packet.prompt.title, packet.id);
  const taskPacketPath = join(runDirectory, "task-packet.json");
  const taskMarkdownPath = join(runDirectory, "task-packet.md");

  await writeJson(taskPacketPath, packet);
  await writeFile(taskMarkdownPath, renderTaskPacketMarkdown(packet), "utf8");

  let capture: BridgeTransportResponse;
  try {
    capture = await adapter.sendAndCapture({
      packet,
      prompt: packet.prompt.body,
      runDirectory
    });
  } catch (error) {
    await writeJson(join(runDirectory, "route-error.json"), {
      stage: "send_or_capture",
      message: error instanceof Error ? error.message : String(error),
      recordedAt: new Date().toISOString()
    });
    throw error;
  }

  const stored = await captureResultForPacket({
    packet,
    responseText: capture.responseText,
    runDirectory,
    captureMeta: capture.captureMeta
  });

  return {
    runDirectory,
    taskPacketPath,
    taskMarkdownPath,
    resultPacketPath: join(runDirectory, "result-packet.json"),
    verdictPath: join(runDirectory, "validation-verdict.json"),
    resultPacket: stored.resultPacket,
    verdict: stored.verdict
  };
}

export async function captureResultForPacket(
  options: CaptureStoredResultOptions
): Promise<{ resultPacket: StoredResultPacket; verdict: ValidationVerdict }> {
  const { packet, responseText, runDirectory, captureMeta } = options;
  const capturedAt = new Date().toISOString();
  const normalizedCaptureMeta = normalizeCaptureMeta(captureMeta, capturedAt);
  const verdict = validateCapturedResult({ packet, responseText });
  const resultPacket: StoredResultPacket = {
    schemaVersion: "0.1",
    kind: "result",
    id: randomUUID(),
    taskPacketId: packet.id,
    responseText,
    redaction: packet.redaction,
    risk: packet.risk,
    deliveryPolicy: packet.deliveryPolicy,
    captureMeta: normalizedCaptureMeta,
    capture: normalizedCaptureMeta,
    receivedAt: capturedAt
  };

  await writeFile(join(runDirectory, "result-raw.md"), `${responseText}\n`, "utf8");
  await writeJson(join(runDirectory, "result-packet.json"), resultPacket);
  await writeJson(join(runDirectory, "validation-verdict.json"), verdict);

  return {
    resultPacket,
    verdict
  };
}

export function validateCapturedResult(input: {
  packet: PreparedTaskPacket;
  responseText: string;
}): ValidationVerdict {
  const reasons: string[] = [];
  const responseText = input.responseText.trim();

  if (!responseText) {
    reasons.push("Captured response is empty.");
  }

  for (const pattern of EXECUTION_CLAIM_PATTERNS) {
    if (pattern.test(responseText)) {
      reasons.push("Response claims local file, workspace, or execution access that ChatGPT should not have.");
      break;
    }
  }

  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(responseText)) {
      reasons.push("Response appears to contain local-only paths, endpoints, or secret-like values.");
      break;
    }
  }

  const maxResponseChars = input.packet.deliveryPolicy.maxResponseChars;
  if (maxResponseChars && responseText.length > maxResponseChars) {
    reasons.push(`Response exceeded the ${maxResponseChars}-character limit.`);
  }

  return {
    schemaVersion: "0.1",
    kind: "validation-verdict",
    status: reasons.length > 0 ? "fail" : "pass",
    reasons,
    checkedAt: new Date().toISOString(),
    taskPacketId: input.packet.id
  };
}

export async function loadTaskPacket(packetPath: string): Promise<PreparedTaskPacket> {
  return JSON.parse(await readFile(packetPath, "utf8")) as PreparedTaskPacket;
}

export function renderTaskPacketMarkdown(packet: PreparedTaskPacket): string {
  const redactionLines =
    packet.redaction.items.length === 0
      ? ["- none"]
      : packet.redaction.items.map((item) => `- ${item.kind}: ${item.source} -> ${item.replacement}`);

  const attachmentLines =
    packet.prompt.attachments.length === 0
      ? ["- none"]
      : packet.prompt.attachments.map(
          (attachment) => `- ${attachment.label} (${attachment.contentType ?? "text/plain"})`
        );

  return [
    `# ${packet.prompt.title}`,
    "",
    `- Packet id: ${packet.id}`,
    `- Risk level: ${packet.risk.level}`,
    `- Delivery mode: ${packet.deliveryPolicy.mode}`,
    "",
    "## Prompt",
    "",
    packet.prompt.body,
    "",
    "## Attachments",
    ...attachmentLines,
    "",
    "## Redactions",
    ...redactionLines
  ].join("\n");
}

async function createRunDirectory(workspaceRoot: string, title: string, packetId: string): Promise<string> {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
  const slug = slugify(title);
  const runDirectory = join(workspaceRoot, "bridge_runs", `${stamp}-${slug}-${packetId.slice(0, 8)}`);
  await mkdir(runDirectory, { recursive: true });
  return runDirectory;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";
}

function enforceDeliveryPolicy(packet: PreparedTaskPacket, confirmSensitive: boolean): void {
  if (packet.deliveryPolicy.mode === "block") {
    throw new Error(`Packet is blocked from routing: ${packet.risk.reasons.join(" ")}`);
  }

  if (packet.risk.requiresHumanConfirmation && !confirmSensitive) {
    throw new Error("Packet requires confirmation before routing.");
  }
}

function buildPromptBody(input: {
  title: string;
  task: string;
  attachments: TaskAttachment[];
  workMode: "advice-only" | "github-only-code";
  maxResponseChars: number;
}): string {
  const modeLine =
    input.workMode === "github-only-code"
      ? "Code work mode: GitHub-only suggestions or review comments are allowed, but do not claim local edits, tests, commits, or PR actions."
      : "Advice mode: provide text-only guidance, drafting, naming, planning, or review feedback.";
  const attachmentBlock =
    input.attachments.length === 0
      ? "Attachments: none"
      : [
          "Attachments:",
          ...input.attachments.map((attachment) =>
            [`[${attachment.label}]`, attachment.content].join("\n")
          )
        ].join("\n\n");

  return [
    "Remote collaboration packet for ChatGPT.",
    "You do not have direct local filesystem, shell, terminal, or tunnel access.",
    "Do not claim that you opened local files, ran commands, edited the workspace, or executed tests.",
    modeLine,
    `Keep the response under ${input.maxResponseChars} characters unless the packet explicitly requests more detail.`,
    "",
    `Title: ${input.title}`,
    "",
    "Task:",
    input.task,
    "",
    attachmentBlock
  ].join("\n");
}

function assessRisk(input: {
  combinedText: string;
  redactionItems: TaskPacket["redaction"]["items"];
  attachmentCount: number;
}): RiskAssessment {
  const reasons: string[] = [];
  let level: RiskAssessment["level"] = "low";
  let requiresHumanConfirmation = false;
  let containsSensitiveData = false;

  if (matchesAny(BLOCKED_PATTERNS, input.combinedText)) {
    level = "critical";
    requiresHumanConfirmation = true;
    containsSensitiveData = true;
    reasons.push("Private-key or credential-dump material was detected.");
  }

  const secretCount = countKinds(input.redactionItems, "secret");
  const personalDataCount = countKinds(input.redactionItems, "personal_data");
  const localPathCount = countKinds(input.redactionItems, "local_path");
  const localEndpointCount = countKinds(input.redactionItems, "local_endpoint");

  if (secretCount > 0) {
    level = "critical";
    requiresHumanConfirmation = true;
    containsSensitiveData = true;
    reasons.push("Secret-like values were redacted.");
  }

  if (personalDataCount > 0) {
    level = level === "critical" ? "critical" : "high";
    requiresHumanConfirmation = true;
    containsSensitiveData = true;
    reasons.push("Personal data was redacted.");
  }

  if (localPathCount > 0 || localEndpointCount > 0) {
    if (level === "low") {
      level = "medium";
    }
    reasons.push("Local paths or endpoints were redacted before routing.");
  }

  if (input.combinedText.length > 12000 || input.attachmentCount > 6) {
    if (level === "low") {
      level = "high";
    }
    requiresHumanConfirmation = true;
    reasons.push("Packet contains broad context and should be reviewed before routing.");
  }

  if (matchesAny(SENSITIVE_TOPIC_PATTERNS, input.combinedText)) {
    if (level === "low") {
      level = "high";
    }
    requiresHumanConfirmation = true;
    containsSensitiveData = true;
    reasons.push("Sensitive subject matter was detected.");
  }

  return {
    level,
    reasons,
    requiresHumanConfirmation,
    containsSensitiveData
  };
}

function buildDeliveryPolicy(risk: RiskAssessment, maxResponseChars: number): DeliveryPolicy {
  if (risk.level === "critical" && risk.reasons.some((reason) => /private-key|credential-dump/i.test(reason))) {
    return {
      mode: "block",
      allowToolUse: false,
      allowFileAccessClaims: false,
      allowExecutionClaims: false,
      requireRedaction: true,
      maxResponseChars
    };
  }

  return {
    mode: risk.requiresHumanConfirmation ? "confirm" : "auto",
    allowToolUse: false,
    allowFileAccessClaims: false,
    allowExecutionClaims: false,
    requireRedaction: true,
    maxResponseChars
  };
}

function redactText(text: string, sink: TaskPacket["redaction"]["items"]): string {
  let output = text;

  output = applyRedactions(output, BLOCKED_PATTERNS, sink, "secret", "[REDACTED_BLOCKED_SECRET]", "blocked credential material");
  output = applyRedactions(output, SECRET_PATTERNS, sink, "secret", "[REDACTED_SECRET]", "secret-like value");
  output = applyRedactions(output, LOCAL_PATH_PATTERNS, sink, "local_path", "[REDACTED_LOCAL_PATH]", "local path");
  output = applyRedactions(
    output,
    LOCAL_ENDPOINT_PATTERNS,
    sink,
    "local_endpoint",
    "[REDACTED_LOCAL_ENDPOINT]",
    "local endpoint"
  );
  output = applyRedactions(
    output,
    PERSONAL_DATA_PATTERNS,
    sink,
    "personal_data",
    "[REDACTED_PII]",
    "personal data"
  );

  return output;
}

function applyRedactions(
  input: string,
  patterns: RegExp[],
  sink: TaskPacket["redaction"]["items"],
  kind: TaskPacket["redaction"]["items"][number]["kind"],
  replacement: string,
  note: string
): string {
  let output = input;

  for (const pattern of patterns) {
    output = output.replace(pattern, (match) => {
      sink.push({
        kind,
        source: summarizeMatch(kind, match),
        replacement,
        note
      });
      return replacement;
    });
  }

  return output;
}

function summarizeMatch(kind: TaskPacket["redaction"]["items"][number]["kind"], match: string): string {
  if (kind === "secret") {
    return `secret(${match.length} chars)`;
  }

  if (kind === "local_path") {
    return "local path";
  }

  if (kind === "local_endpoint") {
    return "local endpoint";
  }

  if (kind === "personal_data") {
    return "personal data";
  }

  return "redacted value";
}

function countKinds(
  items: TaskPacket["redaction"]["items"],
  kind: TaskPacket["redaction"]["items"][number]["kind"]
): number {
  return items.filter((item) => item.kind === kind).length;
}

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function normalizeCaptureMeta(captureMeta: Partial<CaptureMeta> | undefined, capturedAt: string): CaptureMeta {
  return {
    channel: captureMeta?.channel ?? "manual",
    capturedAt: captureMeta?.capturedAt ?? capturedAt,
    source: captureMeta?.source,
    conversationId: captureMeta?.conversationId,
    workspaceRoot: captureMeta?.workspaceRoot,
    notes: captureMeta?.notes
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
