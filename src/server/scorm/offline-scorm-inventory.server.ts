import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";

const maximumRecoveryRecords = 256;

type CleanupState = "cleared" | "clearing" | "needs_attention" | "pending";
type EntitlementStatus = "active" | "resolved";

interface OfflineScormCourseInventoryRow {
  attemptId: string;
  cleanupState: CleanupState;
  courseVersionItemId: string;
  enrollmentId: string | null;
  entitlementId: string;
  entitlementStatus: "active" | "hard_revoked" | "replaced" | "resolved";
  intendedLaunchExpiresAt: Date;
  modulePosition: number | null;
  packageOrigin: string;
  title: string;
}

export interface OfflineScormCourseRecoveryRecord {
  attemptId: string;
  cleanupState: CleanupState;
  courseVersionItemId: string;
  enrollmentId: string;
  entitlementId: string;
  entitlementStatus: EntitlementStatus;
  intendedLaunchExpiresAt: string;
  modulePosition: number;
  packageOrigin: string;
  title: string;
}

interface OfflineScormInventoryDependencies {
  findCourseRows(input: {
    requestedEntitlementIds: readonly string[];
    userId: string;
  }): Promise<readonly OfflineScormCourseInventoryRow[]>;
  findRetainedState(userId: string): Promise<boolean>;
}

const defaultDependencies: OfflineScormInventoryDependencies = {
  async findCourseRows(input) {
    let query = getDatabase()
      .selectFrom("offline_scorm_cleanup_inventory as cleanup")
      .innerJoin(
        "offline_learning_entitlement as entitlement",
        "entitlement.id",
        "cleanup.entitlementId",
      )
      .innerJoin(
        "scorm_attempt as attempt",
        "attempt.id",
        "entitlement.attemptId",
      )
      .innerJoin("enrollment", "enrollment.id", "attempt.enrollmentId")
      .innerJoin("course_version_item as item", (join) =>
        join
          .onRef("item.courseVersionId", "=", "enrollment.courseVersionId")
          .onRef("item.modulePosition", "=", "attempt.modulePosition")
          .onRef(
            "item.learningActivityVersionId",
            "=",
            "entitlement.scormPackageVersionId",
          )
          .on("item.kind", "=", "scorm"),
      )
      .select([
        "entitlement.attemptId",
        "cleanup.state as cleanupState",
        "item.id as courseVersionItemId",
        "attempt.enrollmentId",
        "entitlement.id as entitlementId",
        "entitlement.status as entitlementStatus",
        "entitlement.intendedLaunchExpiresAt",
        "item.modulePosition",
        "cleanup.packageSiteOrigin as packageOrigin",
        "item.title",
      ])
      .where("entitlement.userId", "=", input.userId)
      .where("cleanup.userId", "=", input.userId)
      .where("entitlement.status", "in", ["active", "resolved"]);
    query = query.where((expression) =>
      input.requestedEntitlementIds.length === 0
        ? expression("cleanup.state", "!=", "cleared")
        : expression.or([
            expression("cleanup.state", "!=", "cleared"),
            expression("entitlement.id", "in", input.requestedEntitlementIds),
          ]),
    );
    return await query
      .orderBy("cleanup.createdAt", "asc")
      .limit(maximumRecoveryRecords + 1)
      .execute();
  },
  findRetainedState: (userId) =>
    queryRetainedOfflineScormServerState(getDatabase(), userId),
};

export async function queryRetainedOfflineScormServerState(
  database: Kysely<Database> | Transaction<Database>,
  userId: string,
): Promise<boolean> {
  const retained = await database
    .selectFrom("offline_learning_entitlement as entitlement")
    .leftJoin(
      "offline_scorm_cleanup_inventory as cleanup",
      "cleanup.entitlementId",
      "entitlement.id",
    )
    .select("entitlement.id")
    .where("entitlement.userId", "=", userId)
    .where((expression) =>
      expression.or([
        expression("entitlement.status", "=", "active"),
        expression("cleanup.state", "is", null),
        expression("cleanup.state", "!=", "cleared"),
      ]),
    )
    .executeTakeFirst();
  return retained !== undefined;
}

export async function hasRetainedOfflineScormServerState(
  userId: string,
  dependencies: OfflineScormInventoryDependencies = defaultDependencies,
): Promise<boolean> {
  return await dependencies.findRetainedState(userId);
}

export async function listOfflineScormCourseRecoveryInventory(
  input: {
    requestedEntitlementIds: readonly string[];
    userId: string;
  },
  dependencies: OfflineScormInventoryDependencies = defaultDependencies,
): Promise<OfflineScormCourseRecoveryRecord[]> {
  const rows = await dependencies.findCourseRows(input);
  if (rows.length > maximumRecoveryRecords)
    throw new Error("Offline SCORM recovery inventory exceeds its bound");
  return rows.map((row) => {
    if (
      row.enrollmentId === null ||
      row.enrollmentId.length === 0 ||
      (row.entitlementStatus !== "active" &&
        row.entitlementStatus !== "resolved") ||
      row.modulePosition === null ||
      row.modulePosition < 0
    )
      throw new Error("Offline SCORM recovery inventory is inconsistent");
    return {
      attemptId: row.attemptId,
      cleanupState: row.cleanupState,
      courseVersionItemId: row.courseVersionItemId,
      enrollmentId: row.enrollmentId,
      entitlementId: row.entitlementId,
      entitlementStatus: row.entitlementStatus,
      intendedLaunchExpiresAt: row.intendedLaunchExpiresAt.toISOString(),
      modulePosition: row.modulePosition,
      packageOrigin: row.packageOrigin,
      title: row.title,
    };
  });
}
