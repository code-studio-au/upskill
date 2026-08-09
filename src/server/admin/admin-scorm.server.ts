import "@tanstack/react-start/server-only";

import { sql } from "kysely";
import type { AdminScormPackageSummary } from "#/features/scorm/scorm-package.schema";
import { getDatabase } from "#/server/db/database.server";

export async function findAdminScormPackages(): Promise<
  Array<AdminScormPackageSummary>
> {
  const database = getDatabase();
  const [versions, usages] = await Promise.all([
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
        "scorm_package.createdAt as packageCreatedAt",
        "scorm_package_version.id",
        "scorm_package_version.version",
        "scorm_package_version.status",
        "scorm_package_version.sourceBytes",
        "scorm_package_version.failureCode",
        "scorm_package_version.createdAt",
        "scorm_package_version.processedAt",
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
  ]);
  const usageByVersion = new Map(
    usages.map((usage) => [usage.scormPackageVersionId, usage.count]),
  );
  const packageById = new Map<string, AdminScormPackageSummary>();
  for (const version of versions) {
    let packageSummary = packageById.get(version.packageId);
    if (!packageSummary) {
      packageSummary = {
        id: version.packageId,
        title: version.title,
        createdAt: version.packageCreatedAt.toISOString(),
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
      createdAt: version.createdAt.toISOString(),
      processedAt: version.processedAt?.toISOString() ?? null,
    });
  }
  return [...packageById.values()];
}
