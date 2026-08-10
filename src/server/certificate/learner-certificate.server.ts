import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { getObjectBytes } from "#/server/storage/object-storage.server";

const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;

export type LearnerCertificateResult =
  | { status: "ready"; bytes: Uint8Array; displayName: string }
  | { status: "not-found" | "unavailable" };

function safeFilename(value: string): string {
  const filename = value
    .normalize("NFKD")
    .replaceAll(/[^A-Za-z0-9 -]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-")
    .slice(0, 100);
  return `${filename || "course"}-completion-certificate.pdf`;
}

export async function getLearnerCompletionCertificate(
  certificateId: string,
  user: AuthenticatedUser,
): Promise<LearnerCertificateResult> {
  const certificate = await getDatabase()
    .selectFrom("completion_certificate")
    .innerJoin(
      "enrollment",
      "enrollment.id",
      "completion_certificate.enrollmentId",
    )
    .select([
      "completion_certificate.objectKey",
      "completion_certificate.courseTitle",
      "completion_certificate.status",
    ])
    .where("completion_certificate.id", "=", certificateId)
    .where("enrollment.userId", "=", user.id)
    .whereRef(
      "enrollment.completedAt",
      "=",
      "completion_certificate.completedAt",
    )
    .executeTakeFirst();
  if (!certificate || certificate.status !== "ready")
    return { status: "not-found" };

  try {
    return {
      status: "ready",
      bytes: await getObjectBytes(
        getServerEnv().S3_CERTIFICATES_BUCKET,
        certificate.objectKey,
        MAX_CERTIFICATE_BYTES,
      ),
      displayName: safeFilename(certificate.courseTitle),
    };
  } catch (error) {
    logServerEvent({
      level: "error",
      event: "certificate.download_unavailable",
      error,
      fields: { entityType: "completion_certificate", entityId: certificateId },
    });
    return { status: "unavailable" };
  }
}
