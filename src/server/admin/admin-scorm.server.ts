import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminScormPackageSummary,
  AdminScormRemovalResult,
} from "#/features/scorm/scorm-package.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import {
  SCORM_DELETION_TOPIC,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";

export async function findAdminScormPackages(): Promise<
  Array<AdminScormPackageSummary>
> {
  const database = getDatabase();
  const [versions, usages, attempts] = await Promise.all([
    database
      .selectFrom("scorm_package_version")
      .innerJoin(
        "scorm_package",
        "scorm_package.id",
        "scorm_package_version.packageId",
      )
      .select([
        "scorm_package.id as packageId",
        "scorm_package.title",
        "scorm_package_version.id",
        "scorm_package_version.version",
        "scorm_package_version.status",
        "scorm_package_version.sourceBytes",
        "scorm_package_version.failureCode",
      ])
      .orderBy("scorm_package.title")
      .orderBy("scorm_package.id")
      .orderBy("scorm_package_version.version", "desc")
      .execute(),
    database
      .selectFrom("course_version_module")
      .select([
        "scormPackageVersionId",
        sql<number>`count(*)::integer`.as("count"),
      ])
      .groupBy("scormPackageVersionId")
      .execute(),
    database
      .selectFrom("scorm_attempt")
      .select([
        "scormPackageVersionId",
        sql<number>`count(*)::integer`.as("count"),
      ])
      .groupBy("scormPackageVersionId")
      .execute(),
  ]);
  const usageByVersion = new Map(
    usages.map((usage) => [usage.scormPackageVersionId, usage.count]),
  );
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
    packageSummary.versions.push({
      id: version.id,
      version: version.version,
      status: version.status,
      sourceBytes: version.sourceBytes,
      failureCode: version.failureCode,
      courseUsageCount: usageByVersion.get(version.id) ?? 0,
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
          "scorm_package",
          "scorm_package.id",
          "scorm_package_version.packageId",
        )
        .select([
          "scorm_package_version.id",
          "scorm_package_version.packageId",
          "scorm_package_version.version",
          "scorm_package_version.status",
          "scorm_package_version.contentPrefix",
          "scorm_package.title",
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
          (select count(*)::integer from course_version_module where "scormPackageVersionId" = ${packageVersionId}) as "courseUsageCount",
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

      await transaction
        .deleteFrom("outbox_event")
        .where("topic", "=", SCORM_INGESTION_TOPIC)
        .where("aggregateId", "=", packageVersionId)
        .where("processedAt", "is", null)
        .execute();
      await transaction
        .deleteFrom("scorm_package_version")
        .where("id", "=", packageVersionId)
        .executeTakeFirstOrThrow();
      const remaining = await transaction
        .selectFrom("scorm_package_version")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("packageId", "=", version.packageId)
        .executeTakeFirstOrThrow();
      const packageRemoved = remaining.count === 0;
      if (packageRemoved)
        await transaction
          .deleteFrom("scorm_package")
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
          id: `outbox_${randomUUID()}`,
          topic: SCORM_DELETION_TOPIC,
          aggregateId: packageVersionId,
          payload: {
            packageVersionId,
            quarantinePrefix: `scorm/${packageVersionId}/`,
            contentPrefix: `${version.contentPrefix}/`,
          },
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
