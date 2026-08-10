import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
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
  AdminResourceRemovalResult,
  AdminResourceSummary,
  AdminResourceUploadQuery,
} from "#/features/resource/resource.schema";
import { RESOURCE_DELETION_TOPIC } from "#/server/queue/work-message";

const PDF_SIGNATURE = new TextEncoder().encode("%PDF-");

export class PdfResourceValidationError extends Error {
  constructor(public readonly code: "invalid_pdf") {
    super(code);
    this.name = "PdfResourceValidationError";
  }
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_SIGNATURE.byteLength) return false;
  for (let index = 0; index < PDF_SIGNATURE.byteLength; index += 1)
    if (bytes[index] !== PDF_SIGNATURE[index]) return false;
  return true;
}

export async function findAdminResources(): Promise<
  Array<AdminResourceSummary>
> {
  const database = getDatabase();
  const [versions, usages] = await Promise.all([
    database
      .selectFrom("learning_resource_version")
      .innerJoin(
        "learning_resource",
        "learning_resource.id",
        "learning_resource_version.resourceId",
      )
      .select([
        "learning_resource.id as resourceId",
        "learning_resource.title",
        "learning_resource_version.id",
        "learning_resource_version.version",
        "learning_resource_version.displayName",
        "learning_resource_version.description",
        "learning_resource_version.sourceBytes",
      ])
      .orderBy("learning_resource.title")
      .orderBy("learning_resource.id")
      .orderBy("learning_resource_version.version", "desc")
      .execute(),
    database
      .selectFrom("course_version_item")
      .select(["resourceVersionId", sql<number>`count(*)::integer`.as("count")])
      .where("resourceVersionId", "is not", null)
      .groupBy("resourceVersionId")
      .execute(),
  ]);
  const usageByVersion = new Map(
    usages.map((usage) => [usage.resourceVersionId, usage.count]),
  );
  const resourceById = new Map<string, AdminResourceSummary>();
  for (const version of versions) {
    let resource = resourceById.get(version.resourceId);
    if (!resource) {
      resource = { id: version.resourceId, title: version.title, versions: [] };
      resourceById.set(version.resourceId, resource);
    }
    resource.versions.push({
      id: version.id,
      version: version.version,
      displayName: version.displayName,
      description: version.description,
      sourceBytes: version.sourceBytes,
      courseUsageCount: usageByVersion.get(version.id) ?? 0,
    });
  }
  return [...resourceById.values()];
}

export async function removeAdminResourceVersion(
  resourceVersionId: string,
  actorUserId: string,
): Promise<AdminResourceRemovalResult> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("learning_resource_version")
        .innerJoin(
          "learning_resource",
          "learning_resource.id",
          "learning_resource_version.resourceId",
        )
        .select([
          "learning_resource_version.id",
          "learning_resource_version.resourceId",
          "learning_resource_version.version",
          "learning_resource_version.objectKey",
        ])
        .where("learning_resource_version.id", "=", resourceVersionId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return { status: "not-found" };

      const reference = await transaction
        .selectFrom("course_version_item")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("resourceVersionId", "=", resourceVersionId)
        .executeTakeFirstOrThrow();
      if (reference.count > 0)
        return {
          status: "in-use",
          data: { courseUsageCount: reference.count },
        };

      await transaction
        .deleteFrom("learning_resource_version")
        .where("id", "=", resourceVersionId)
        .executeTakeFirstOrThrow();
      const remaining = await transaction
        .selectFrom("learning_resource_version")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("resourceId", "=", version.resourceId)
        .executeTakeFirstOrThrow();
      const resourceRemoved = remaining.count === 0;
      if (resourceRemoved)
        await transaction
          .deleteFrom("learning_resource")
          .where("id", "=", version.resourceId)
          .executeTakeFirstOrThrow();

      const now = new Date();
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "resource.version_removed",
        subjectType: "learning_resource_version",
        subjectId: resourceVersionId,
        aggregateId: version.resourceId,
        metadata: {
          resourceId: version.resourceId,
          resourceRemoved,
          version: version.version,
        },
        createdAt: now,
      });
      await transaction
        .insertInto("outbox_event")
        .values({
          id: `outbox_${randomUUID()}`,
          topic: RESOURCE_DELETION_TOPIC,
          aggregateId: resourceVersionId,
          payload: {
            resourceVersionId,
            objectKey: version.objectKey,
          },
          availableAt: now,
          processedAt: null,
          createdAt: now,
        })
        .execute();
      return {
        status: "removed",
        data: {
          resourceId: version.resourceId,
          resourceRemoved,
          version: version.version,
        },
      };
    });
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
