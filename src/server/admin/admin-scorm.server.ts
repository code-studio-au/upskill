import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminScormPackageSummary,
  AdminScormRemovalResult,
} from "#/features/scorm/scorm-package.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { findContentCourseVersionUsage } from "#/server/admin/content-usage.server";
import {
  parseScormWorkMessage,
  SCORM_DELETION_TOPIC,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";

export async function findAdminScormPackages(): Promise<
  Array<AdminScormPackageSummary>
> {
  const database = getDatabase();
  const [versions, courseUsage, attempts] = await Promise.all([
    database
      .selectFrom("scorm_package_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "scorm_package_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "learning_activity.id as packageId",
        "learning_activity.title",
        "scorm_package_version.id",
        "learning_activity_version.version",
        "scorm_package_version.status",
        "scorm_package_version.sourceBytes",
        "scorm_package_version.failureCode",
      ])
      .orderBy("learning_activity.title")
      .orderBy("learning_activity.id")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    findContentCourseVersionUsage(),
    database
      .selectFrom("scorm_attempt")
      .select([
        "scormPackageVersionId",
        sql<number>`count(*)::integer`.as("count"),
      ])
      .groupBy("scormPackageVersionId")
      .execute(),
  ]);
  const attemptsByVersion = new Map(
    attempts.map((attempt) => [attempt.scormPackageVersionId, attempt.count]),
  );
  const packageById = new Map<string, AdminScormPackageSummary>();
  for (const version of versions) {
    let packageSummary = packageById.get(version.packageId);
    if (!packageSummary) {
      packageSummary = {
        id: version.packageId,
        title: version.title,
        versions: [],
      };
      packageById.set(version.packageId, packageSummary);
    }
    const courseUsages = courseUsage.modules.get(version.id) ?? [];
    packageSummary.versions.push({
      id: version.id,
      version: version.version,
      status: version.status,
      sourceBytes: version.sourceBytes,
      failureCode: version.failureCode,
      courseUsageCount: courseUsages.length,
      courseUsages,
      attemptCount: attemptsByVersion.get(version.id) ?? 0,
    });
  }
  return [...packageById.values()];
}

export async function removeAdminScormPackageVersion(
  packageVersionId: string,
  actorUserId: string,
): Promise<AdminScormRemovalResult> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("scorm_package_version")
        .innerJoin(
          "learning_activity_version",
          "learning_activity_version.id",
          "scorm_package_version.id",
        )
        .innerJoin(
          "learning_activity",
          "learning_activity.id",
          "learning_activity_version.activityId",
        )
        .select([
          "scorm_package_version.id",
          "learning_activity_version.activityId as packageId",
          "learning_activity_version.version",
          "scorm_package_version.status",
          "scorm_package_version.contentPrefix",
          "learning_activity.title",
        ])
        .where("scorm_package_version.id", "=", packageVersionId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return { status: "not-found" };
      if (version.status === "quarantined" || version.status === "processing")
        return { status: "verification-pending" };

      const referenceResult = await sql<{
        attemptCount: number;
        courseUsageCount: number;
      }>`select
          (select count(*)::integer from course_version_item where "learningActivityVersionId" = ${packageVersionId}) as "courseUsageCount",
          (select count(*)::integer from scorm_attempt where "scormPackageVersionId" = ${packageVersionId}) as "attemptCount"`.execute(
        transaction,
      );
      const references = referenceResult.rows[0];
      if (!references)
        throw new Error("SCORM reference counts are unavailable");
      if (references.courseUsageCount > 0 || references.attemptCount > 0)
        return {
          status: "in-use",
          data: {
            courseUsageCount: references.courseUsageCount,
            attemptCount: references.attemptCount,
          },
        };

      const outboxId = `outbox_${randomUUID()}`;
      const deletionPayload = {
        packageVersionId,
        quarantinePrefix: `scorm/${packageVersionId}/`,
        contentPrefix: `${version.contentPrefix}/`,
      };
      parseScormWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: outboxId,
          topic: SCORM_DELETION_TOPIC,
          aggregateId: packageVersionId,
          payload: deletionPayload,
        }),
      );

      await transaction
        .deleteFrom("outbox_event")
        .where("topic", "=", SCORM_INGESTION_TOPIC)
        .where("aggregateId", "=", packageVersionId)
        .where("processedAt", "is", null)
        .execute();
      await transaction
        .deleteFrom("learning_activity_version")
        .where("id", "=", packageVersionId)
        .executeTakeFirstOrThrow();
      const remaining = await transaction
        .selectFrom("learning_activity_version")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("activityId", "=", version.packageId)
        .executeTakeFirstOrThrow();
      const packageRemoved = remaining.count === 0;
      if (packageRemoved)
        await transaction
          .deleteFrom("learning_activity")
          .where("id", "=", version.packageId)
          .executeTakeFirstOrThrow();

      const now = new Date();
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "scorm.package_version_removed",
        subjectType: "scorm_package_version",
        subjectId: packageVersionId,
        metadata: {
          packageId: version.packageId,
          packageRemoved,
          version: version.version,
        },
        createdAt: now,
      });
      await transaction
        .insertInto("outbox_event")
        .values({
          id: outboxId,
          topic: SCORM_DELETION_TOPIC,
          aggregateId: packageVersionId,
          payload: deletionPayload,
          availableAt: now,
          processedAt: null,
          createdAt: now,
        })
        .execute();
      return {
        status: "removed",
        data: {
          packageId: version.packageId,
          packageRemoved,
          version: version.version,
        },
      };
    });
}
