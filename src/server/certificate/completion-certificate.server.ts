import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { Database } from "#/server/db/types";
import { CERTIFICATE_GENERATION_TOPIC } from "#/server/queue/work-message";

export async function requestCompletionCertificate(
  transaction: Transaction<Database>,
  input: { enrollmentId: string; courseVersionId: string },
  now: Date,
): Promise<string | null> {
  const completion = await transaction
    .selectFrom("enrollment")
    .innerJoin("user", "user.id", "enrollment.userId")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .select([
      "enrollment.completedAt",
      "enrollment.courseVersionId",
      "user.name as learnerName",
      "course_version.content",
    ])
    .where("enrollment.id", "=", input.enrollmentId)
    .executeTakeFirstOrThrow();
  if (
    completion.courseVersionId !== input.courseVersionId ||
    !completion.completedAt
  )
    throw new Error("Certificate request does not match a completion");

  const content = courseContentSchema.parse(completion.content);
  if (!content.hasCompletionCertificate) return null;

  const certificateId = `certificate_${randomUUID()}`;
  const objectKey = `certificates/${certificateId}.pdf`;
  const inserted = await transaction
    .insertInto("completion_certificate")
    .values({
      id: certificateId,
      enrollmentId: input.enrollmentId,
      courseVersionId: input.courseVersionId,
      learnerName: completion.learnerName,
      courseTitle: content.title,
      completedAt: completion.completedAt,
      objectKey,
      status: "pending",
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict.columns(["enrollmentId", "completedAt"]).doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  if (!inserted) {
    const existing = await transaction
      .selectFrom("completion_certificate")
      .select("id")
      .where("enrollmentId", "=", input.enrollmentId)
      .where("completedAt", "=", completion.completedAt)
      .executeTakeFirstOrThrow();
    return existing.id;
  }

  await transaction
    .insertInto("outbox_event")
    .values({
      id: `outbox_${randomUUID()}`,
      topic: CERTIFICATE_GENERATION_TOPIC,
      aggregateId: certificateId,
      payload: { certificateId, objectKey },
      availableAt: now,
      processedAt: null,
      createdAt: now,
    })
    .execute();
  return certificateId;
}
