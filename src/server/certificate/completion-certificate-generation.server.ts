import "@tanstack/react-start/server-only";

import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { renderCompletionCertificate } from "#/server/certificate/completion-certificate-pdf.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { putObject } from "#/server/storage/object-storage.server";

export type CertificateGenerationOutcome =
  { status: "ready" } | { status: "already-ready" };

export async function generateCompletionCertificate(
  certificateId: string,
  objectKey: string,
): Promise<CertificateGenerationOutcome> {
  const database = getDatabase();
  const certificate = await database
    .selectFrom("completion_certificate")
    .selectAll()
    .where("id", "=", certificateId)
    .executeTakeFirstOrThrow();
  if (certificate.objectKey !== objectKey)
    throw new Error("Certificate object key does not match the database");
  if (certificate.status === "ready") return { status: "already-ready" };

  const bytes = await renderCompletionCertificate({
    certificateId,
    learnerName: certificate.learnerName,
    courseTitle: certificate.courseTitle,
    completedAt: certificate.completedAt,
  });
  await putObject({
    Bucket: getServerEnv().S3_CERTIFICATES_BUCKET,
    Key: objectKey,
    Body: bytes,
    ContentType: "application/pdf",
    CacheControl: "private, no-store",
  });

  return database.transaction().execute(async (transaction) => {
    const locked = await transaction
      .selectFrom("completion_certificate")
      .select(["status", "enrollmentId", "courseVersionId"])
      .where("id", "=", certificateId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.status === "ready") return { status: "already-ready" };
    const issuedAt = new Date();
    await transaction
      .updateTable("completion_certificate")
      .set({ status: "ready", issuedAt, updatedAt: issuedAt })
      .where("id", "=", certificateId)
      .executeTakeFirstOrThrow();
    await recordDurableAuditEvent(transaction, {
      actorUserId: null,
      action: "certificate.issued",
      subjectType: "completion_certificate",
      subjectId: certificateId,
      aggregateId: locked.enrollmentId,
      metadata: {
        enrollmentId: locked.enrollmentId,
        courseVersionId: locked.courseVersionId,
      },
      createdAt: issuedAt,
    });
    return { status: "ready" };
  });
}
