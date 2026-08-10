import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import {
  deleteObject,
  putObject,
} from "#/server/storage/object-storage.server";
import type {
  AdminCourseResourceOption,
  AdminResourceUploadQuery,
} from "#/features/admin-course/admin-course.schema";

const PDF_SIGNATURE = new TextEncoder().encode("%PDF-");

export class PdfResourceValidationError extends Error {
  constructor(public readonly code: "invalid_pdf") {
    super(code);
    this.name = "PdfResourceValidationError";
  }
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PDF_SIGNATURE.byteLength &&
    PDF_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

export async function uploadAdminPdfResource(input: {
  metadata: AdminResourceUploadQuery;
  bytes: Uint8Array;
  administrator: AuthenticatedUser;
}): Promise<AdminCourseResourceOption> {
  if (!hasPdfSignature(input.bytes))
    throw new PdfResourceValidationError("invalid_pdf");

  const database = getDatabase();
  const resourceId = input.metadata.resourceId ?? `resource_${randomUUID()}`;
  const resourceVersionId = `resource_version_${randomUUID()}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const objectKey = `resources/${resourceVersionId}/${sha256}.pdf`;
  const bucket = getServerEnv().S3_PRIVATE_RESOURCES_BUCKET;
  let objectCreated = false;

  try {
    const result = await putObject({
      Bucket: bucket,
      Key: objectKey,
      Body: input.bytes,
      ContentType: "application/pdf",
      ContentLength: input.bytes.byteLength,
      Metadata: { sha256 },
    });
    objectCreated = result === "created";

    const version = await database
      .transaction()
      .execute(async (transaction) => {
        let nextVersion = 1;
        if (input.metadata.resourceId) {
          const resource = await transaction
            .selectFrom("learning_resource")
            .select("id")
            .where("id", "=", input.metadata.resourceId)
            .forUpdate()
            .executeTakeFirst();
          if (!resource) throw new Error("Learning resource not found");
          const latest = await transaction
            .selectFrom("learning_resource_version")
            .select("version")
            .where("resourceId", "=", resourceId)
            .orderBy("version", "desc")
            .executeTakeFirst();
          nextVersion = (latest?.version ?? 0) + 1;
          await transaction
            .updateTable("learning_resource")
            .set({ title: input.metadata.title })
            .where("id", "=", resourceId)
            .executeTakeFirstOrThrow();
        } else {
          await transaction
            .insertInto("learning_resource")
            .values({ id: resourceId, title: input.metadata.title })
            .execute();
        }
        await transaction
          .insertInto("learning_resource_version")
          .values({
            id: resourceVersionId,
            resourceId,
            version: nextVersion,
            displayName: input.metadata.displayName,
            description: input.metadata.description,
            objectKey,
            sha256,
            sourceBytes: input.bytes.byteLength,
            mediaType: "application/pdf",
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: input.administrator.id,
          action: "resource.uploaded",
          subjectType: "learning_resource_version",
          subjectId: resourceVersionId,
          aggregateId: resourceId,
          metadata: {
            resourceId,
            version: nextVersion,
            sourceBytes: input.bytes.byteLength,
            sha256,
          },
        });
        return nextVersion;
      });

    return {
      id: resourceVersionId,
      resourceId,
      title: input.metadata.title,
      displayName: input.metadata.displayName,
      description: input.metadata.description,
      version,
      sourceBytes: input.bytes.byteLength,
    };
  } catch (error) {
    if (objectCreated)
      await deleteObject(bucket, objectKey).catch(() => undefined);
    throw error;
  }
}
