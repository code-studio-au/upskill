import "@tanstack/react-start/server-only";

export type ServerLogLevel = "info" | "warn" | "error";

type ServerLogCategory = "operational" | "audit";
type ServerLogFieldValue = string | number | boolean | null;

export type ServerLogFields = Readonly<
  Record<string, ServerLogFieldValue | undefined>
>;

type ServerLogEntry = {
  timestamp: string;
  service: "upskill";
  environment: string;
  level: ServerLogLevel;
  type: string;
  category: ServerLogCategory;
  errorType?: string;
} & Record<string, ServerLogFieldValue | undefined>;

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.]{2,79}$/u;
const MAX_FIELD_STRING_LENGTH = 512;
export const MAX_SERVER_LOG_BYTES = 8 * 1024;
const RESERVED_FIELD_NAMES = new Set([
  "timestamp",
  "service",
  "environment",
  "level",
  "type",
  "category",
  "errorType",
]);
const APPROVED_FIELD_NAMES = new Set([
  "requestId",
  "eventId",
  "messageId",
  "actorUserId",
  "entityType",
  "entityId",
  "aggregateId",
  "packageVersionId",
  "enrollmentId",
  "orderId",
  "method",
  "path",
  "status",
  "outcome",
  "code",
  "reasonCode",
  "attempts",
  "receiveCount",
  "durationMs",
  "affectedCount",
]);
const APPROVED_AUDIT_FIELD_NAMES = new Set([
  "eventId",
  "actorUserId",
  "entityType",
  "entityId",
  "aggregateId",
  "outcome",
  "reasonCode",
  "affectedCount",
]);
const LOG_LEVEL_PRIORITY: Record<ServerLogLevel, number> = {
  info: 10,
  warn: 20,
  error: 30,
};

type RuntimeProcess = {
  env?: Record<string, string | undefined>;
};

function runtimeEnv(name: string): string | undefined {
  return (globalThis as { process?: RuntimeProcess }).process?.env?.[name];
}

function configuredLogLevel(): ServerLogLevel | "off" {
  const configured = runtimeEnv("UPSKILL_LOG_LEVEL")?.trim().toLowerCase();
  if (
    configured === "off" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error"
  )
    return configured;
  return "info";
}

function environmentName(): string {
  return (
    runtimeEnv("APP_ENV")?.trim().slice(0, MAX_FIELD_STRING_LENGTH) ||
    runtimeEnv("NODE_ENV")?.trim().slice(0, MAX_FIELD_STRING_LENGTH) ||
    "development"
  );
}

function normalizeEventName(event: string): string {
  return EVENT_NAME_PATTERN.test(event) ? event : "invalid_server_log_event";
}

function classifyThrownValue(error: unknown): string {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof AggregateError) return "AggregateError";
    if (error instanceof Error) return "Error";
  } catch {
    return "UnknownThrownValue";
  }
  if (error === null) return "NullThrownValue";
  if (typeof error === "undefined") return "UndefinedThrownValue";
  return "NonErrorThrownValue";
}

function safeLogFields(
  fields: ServerLogFields | undefined,
  approvedFieldNames = APPROVED_FIELD_NAMES,
): ServerLogFields {
  if (!fields) return {};
  const safe: Record<string, ServerLogFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      RESERVED_FIELD_NAMES.has(key) ||
      !approvedFieldNames.has(key) ||
      typeof value === "undefined"
    )
      continue;
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      safe[key] = value;
    else if (typeof value === "string")
      safe[key] = value.slice(0, MAX_FIELD_STRING_LENGTH);
  }
  return safe;
}

function serializeLogEntry(entry: ServerLogEntry): string {
  const serialized = JSON.stringify(entry);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_SERVER_LOG_BYTES)
    return serialized;
  return JSON.stringify({
    timestamp: entry.timestamp,
    service: entry.service,
    environment: entry.environment,
    level: entry.level,
    type: "server_log_entry_too_large",
    category: entry.category,
  });
}

function writeLogEntry(entry: ServerLogEntry): void {
  try {
    console[entry.level](serializeLogEntry(entry));
  } catch {
    // Logging is best effort and must never change application behavior.
  }
}

function baseEntry(
  level: ServerLogLevel,
  event: string,
  category: ServerLogCategory,
): ServerLogEntry {
  return {
    timestamp: new Date().toISOString(),
    service: "upskill",
    environment: environmentName(),
    level,
    type: normalizeEventName(event),
    category,
  };
}

export function logServerEvent(args: {
  level: ServerLogLevel;
  event: string;
  error?: unknown;
  fields?: ServerLogFields;
}): void {
  const configured = configuredLogLevel();
  if (
    configured === "off" ||
    LOG_LEVEL_PRIORITY[args.level] < LOG_LEVEL_PRIORITY[configured]
  )
    return;
  writeLogEntry({
    ...baseEntry(args.level, args.event, "operational"),
    ...safeLogFields(args.fields),
    ...("error" in args ? { errorType: classifyThrownValue(args.error) } : {}),
  });
}

export function logAuditEvent(args: {
  event: string;
  fields: ServerLogFields;
}): void {
  writeLogEntry({
    ...baseEntry("info", args.event, "audit"),
    ...safeLogFields(args.fields, APPROVED_AUDIT_FIELD_NAMES),
  });
}
