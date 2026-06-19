export type BridgeSchemaVersion = "0.1";

export type PacketKind = "task" | "result" | "validation-verdict";

export type RedactionKind =
  | "secret"
  | "local_path"
  | "local_endpoint"
  | "personal_data"
  | "other";

export interface RedactionItem {
  kind: RedactionKind;
  source: string;
  replacement: string;
  note?: string;
}

export interface RedactionSet {
  items: RedactionItem[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  requiresHumanConfirmation: boolean;
  containsSensitiveData: boolean;
}

export type DeliveryMode = "auto" | "confirm" | "block";

export interface DeliveryPolicy {
  mode: DeliveryMode;
  allowToolUse: boolean;
  allowFileAccessClaims: boolean;
  allowExecutionClaims: boolean;
  requireRedaction: boolean;
  maxResponseChars?: number;
}

export type CaptureChannel = "browser" | "chrome" | "chatgpt" | "manual" | "api" | string;

export interface CaptureMeta {
  channel: CaptureChannel;
  capturedAt: string;
  source?: string;
  conversationId?: string;
  workspaceRoot?: string;
  notes?: string;
}

export interface TaskAttachment {
  label: string;
  content: string;
  contentType?: string;
}

export interface TaskPrompt {
  title: string;
  body: string;
  attachments: TaskAttachment[];
}

export interface TaskPacket {
  schemaVersion: BridgeSchemaVersion;
  kind: "task";
  id: string;
  prompt: TaskPrompt;
  redaction: RedactionSet;
  risk: RiskAssessment;
  deliveryPolicy: DeliveryPolicy;
  captureMeta: CaptureMeta;
}

export interface ResultPacket {
  schemaVersion: BridgeSchemaVersion;
  kind: "result";
  id: string;
  taskPacketId: string;
  responseText: string;
  redaction?: RedactionSet;
  risk: RiskAssessment;
  deliveryPolicy: DeliveryPolicy;
  captureMeta: CaptureMeta;
  receivedAt: string;
}

export type ValidationStatus = "pass" | "fail";

export interface ValidationVerdict {
  schemaVersion: BridgeSchemaVersion;
  kind: "validation-verdict";
  status: ValidationStatus;
  reasons: string[];
  checkedAt: string;
  taskPacketId: string;
  resultPacketId?: string;
}

export type BridgeRecord = TaskPacket | ResultPacket | ValidationVerdict;
