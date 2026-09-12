import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { findEventVirtualRecordingAccess } from "./event-virtual-recording-access.server";

const RECORDING_DOWNLOAD_EXPIRY_SECONDS = 60;
const RECORDING_DOWNLOAD_TOKEN_PREFIX = "upskill-recording-download-v1:";

interface RecordingDownloadTokenClaims {
  eventOccurrenceId: string;
  expiresAt: number;
  recordingId: string;
  userId: string;
}

type RecordingDownloadTokenIssuer = (
  claims: RecordingDownloadTokenClaims,
) => string;

export type EventVirtualRecordingDownloadResult =
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "recording_unavailable" };

export type EventVirtualRecordingDownloadAccessResult =
  | {
      status: "ready";
      target: { storageObjectKey: string; expiresAt: Date };
    }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "recording_unavailable" };

function assertValidTime(now: Date): void {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Recording download time is invalid");
}

function downloadTokenSignature(payload: string): Buffer {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`${RECORDING_DOWNLOAD_TOKEN_PREFIX}${payload}`, "utf8")
    .digest();
}

export function issueEventVirtualRecordingDownloadToken(
  claims: RecordingDownloadTokenClaims,
): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  return `${payload}.${downloadTokenSignature(payload).toString("base64url")}`;
}

export function verifyEventVirtualRecordingDownloadToken(
  token: string,
  expected: {
    eventOccurrenceId: string;
    recordingId: string;
    userId: string;
  },
  now = new Date(),
): RecordingDownloadTokenClaims | null {
  assertValidTime(now);
  if (token.length > 2_048) return null;
  const separator = token.indexOf(".");
  if (separator < 1 || separator !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(signature)
  )
    return null;
  const suppliedSignature = Buffer.from(signature, "base64url");
  const expectedSignature = downloadTokenSignature(payload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  )
    return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claims = value as Partial<RecordingDownloadTokenClaims>;
  const currentTime = now.getTime();
  if (
    claims.eventOccurrenceId !== expected.eventOccurrenceId ||
    claims.recordingId !== expected.recordingId ||
    claims.userId !== expected.userId ||
    typeof claims.expiresAt !== "number" ||
    !Number.isInteger(claims.expiresAt) ||
    claims.expiresAt <= currentTime ||
    claims.expiresAt > currentTime + RECORDING_DOWNLOAD_EXPIRY_SECONDS * 1_000
  )
    return null;
  return claims as RecordingDownloadTokenClaims;
}

export async function issueEventVirtualRecordingDownload(
  input: { eventOccurrenceId: string; recordingId: string },
  user: AuthenticatedUser,
  options: {
    now?: Date;
    issueToken?: RecordingDownloadTokenIssuer;
  } = {},
): Promise<EventVirtualRecordingDownloadResult> {
  const now = options.now ?? new Date();
  assertValidTime(now);
  const issueToken =
    options.issueToken ?? issueEventVirtualRecordingDownloadToken;
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const access = await findEventVirtualRecordingAccess(
      transaction,
      input,
      user.id,
      now,
      "share",
    );
    if (access.status !== "ready") return access;
    const recording = access.target;
    const remainingRetentionSeconds = Math.floor(
      (recording.retentionDeadline.getTime() - now.getTime()) / 1_000,
    );
    if (remainingRetentionSeconds < 1)
      return { status: "conflict", reason: "recording_unavailable" };
    const expiresInSeconds = Math.min(
      RECORDING_DOWNLOAD_EXPIRY_SECONDS,
      remainingRetentionSeconds,
    );
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1_000);
    const token = issueToken({
      eventOccurrenceId: input.eventOccurrenceId,
      recordingId: recording.id,
      userId: user.id,
      expiresAt: expiresAt.getTime(),
    });
    const url = `/api/play/${encodeURIComponent(recording.id)}?occurrence=${encodeURIComponent(input.eventOccurrenceId)}&download=${encodeURIComponent(token)}`;
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_recording.download_issued",
      subjectType: "event_virtual_recording",
      subjectId: recording.id,
      aggregateId: recording.roomId,
      metadata: {
        roomId: recording.roomId,
        eventSessionId: recording.eventSessionId,
        roomGeneration: recording.roomGeneration,
        accessMode: "application_download",
        expiresAt: expiresAt.toISOString(),
      },
      createdAt: now,
    });
    return { status: "ready", url, expiresAt: expiresAt.toISOString() };
  });
}

export async function accessEventVirtualRecordingDownload(
  input: { eventOccurrenceId: string; recordingId: string; token: string },
  user: AuthenticatedUser,
  now = new Date(),
): Promise<EventVirtualRecordingDownloadAccessResult> {
  assertValidTime(now);
  const claims = verifyEventVirtualRecordingDownloadToken(
    input.token,
    {
      eventOccurrenceId: input.eventOccurrenceId,
      recordingId: input.recordingId,
      userId: user.id,
    },
    now,
  );
  if (!claims) return { status: "not-found" };
  const access = await findEventVirtualRecordingAccess(
    getDatabase(),
    input,
    user.id,
    now,
  );
  if (access.status !== "ready") return access;
  return {
    status: "ready",
    target: {
      storageObjectKey: access.target.storageObjectKey,
      expiresAt: new Date(claims.expiresAt),
    },
  };
}

export async function isEventVirtualRecordingDownloadActive(
  input: { eventOccurrenceId: string; recordingId: string },
  userId: string,
  expiresAt: Date,
  now = new Date(),
): Promise<boolean> {
  assertValidTime(now);
  if (expiresAt <= now) return false;
  return (
    (await findEventVirtualRecordingAccess(getDatabase(), input, userId, now))
      .status === "ready"
  );
}
