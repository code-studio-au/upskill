import "@tanstack/react-start/server-only";

import {
  offlineScormCleanupConfirmationSchema,
  offlineScormResolutionRequestSchema,
  offlineScormResolutionSuccessSchema,
} from "#/features/scorm/offline-scorm-activation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { lockScormProgressOwner } from "#/server/scorm/scorm-progress-transaction.server";
import {
  createOfflineScormPackageCleanupCapability,
  createOfflineScormPackageCleanupReceipt,
} from "#/server/scorm/offline-scorm-package-site.server";

export type OfflineScormResolutionResult =
  | {
      status: "cleanup-required";
      entitlementId: string;
      packageSiteOrigin: string;
      cleanupCapability: string;
    }
  | { status: "denied"; reason: "unavailable" | "event-not-supported" };

export async function resolveOfflineScormCourseEntitlement(
  input: unknown,
  user: AuthenticatedUser,
): Promise<OfflineScormResolutionResult> {
  const request = offlineScormResolutionRequestSchema.parse(input);
  const environment = getServerEnv();

  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const identity = await transaction
        .selectFrom("offline_learning_entitlement as entitlement")
        .innerJoin(
          "scorm_attempt as attempt",
          "attempt.id",
          "entitlement.attemptId",
        )
        .select(["attempt.enrollmentId", "attempt.eventParticipationId"])
        .where("entitlement.id", "=", request.entitlementId)
        .where("entitlement.userId", "=", user.id)
        .executeTakeFirst();
      if (!identity)
        return { status: "denied", reason: "unavailable" } as const;
      const owner = await lockScormProgressOwner(transaction, identity);
      if (!owner) return { status: "denied", reason: "unavailable" } as const;
      if (owner.kind !== "course")
        return { status: "denied", reason: "event-not-supported" } as const;

      const entitlement = await transaction
        .selectFrom("offline_learning_entitlement")
        .select(["id", "attemptId", "status", "resolution", "writerGeneration"])
        .where("id", "=", request.entitlementId)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!entitlement)
        return { status: "denied", reason: "unavailable" } as const;
      const cleanup = await transaction
        .selectFrom("offline_scorm_cleanup_inventory")
        .select(["packageSiteOrigin", "state", "clearRequestedAt"])
        .where("entitlementId", "=", entitlement.id)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!cleanup || cleanup.state === "cleared")
        return { status: "denied", reason: "unavailable" } as const;

      if (entitlement.status === "active") {
        const attempt = await transaction
          .selectFrom("scorm_attempt")
          .select([
            "id",
            "writerMode",
            "offlineEntitlementId",
            "credentialGeneration",
          ])
          .where("id", "=", entitlement.attemptId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (
          attempt.writerMode !== "offline" ||
          attempt.offlineEntitlementId !== entitlement.id ||
          attempt.credentialGeneration !== entitlement.writerGeneration
        )
          return { status: "denied", reason: "unavailable" } as const;
        const endedAt = new Date();
        await transaction
          .updateTable("scorm_attempt")
          .set({
            writerMode: "online",
            offlineEntitlementId: null,
            credentialGeneration: attempt.credentialGeneration + 1,
            updatedAt: endedAt,
          })
          .where("id", "=", attempt.id)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable("offline_learning_entitlement")
          .set({
            status: "resolved",
            resolution: request.resolution,
            resolvedByUserId: user.id,
            endedAt,
          })
          .where("id", "=", entitlement.id)
          .executeTakeFirstOrThrow();
      } else if (
        entitlement.status !== "resolved" ||
        entitlement.resolution !== request.resolution
      )
        return { status: "denied", reason: "unavailable" } as const;

      const clearRequestedAt = cleanup.clearRequestedAt ?? new Date();
      if (cleanup.state === "pending" || cleanup.state === "needs_attention")
        await transaction
          .updateTable("offline_scorm_cleanup_inventory")
          .set({
            state: "clearing",
            clearRequestedAt,
            clearedAt: null,
            cleanupReceiptSha256: null,
            lastErrorCode: null,
            updatedAt: new Date(),
          })
          .where("entitlementId", "=", entitlement.id)
          .executeTakeFirstOrThrow();

      return offlineScormResolutionSuccessSchema.parse({
        status: "cleanup-required",
        entitlementId: entitlement.id,
        packageSiteOrigin: cleanup.packageSiteOrigin,
        cleanupCapability: createOfflineScormPackageCleanupCapability(
          environment,
          {
            entitlementId: entitlement.id,
            packageSiteOrigin: cleanup.packageSiteOrigin,
          },
        ),
      });
    });

  if (result.status === "cleanup-required")
    logServerEvent({
      level: "info",
      event: "scorm.offline_writer_resolved",
      fields: {
        actorUserId: user.id,
        entityType: "offline_learning_entitlement",
        entityId: request.entitlementId,
        reasonCode: request.resolution,
      },
    });
  return result;
}

export async function confirmOfflineScormPackageCleanup(
  input: unknown,
  user: AuthenticatedUser,
): Promise<{ status: "cleared" } | { status: "denied" }> {
  const request = offlineScormCleanupConfirmationSchema.parse(input);
  const updated = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const cleanup = await transaction
        .selectFrom("offline_scorm_cleanup_inventory")
        .select([
          "state",
          "cleanupReceiptSha256",
          "packageSiteOrigin",
          "installationId",
          "clearedAt",
        ])
        .where("entitlementId", "=", request.entitlementId)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!cleanup) return false;
      const expectedReceipt = createOfflineScormPackageCleanupReceipt(
        getServerEnv(),
        {
          entitlementId: request.entitlementId,
          packageSiteOrigin: cleanup.packageSiteOrigin,
        },
      );
      let clearedAt: Date;
      if (cleanup.state === "cleared") {
        if (
          cleanup.cleanupReceiptSha256 !== request.cleanupReceiptSha256 ||
          request.cleanupReceiptSha256 !== expectedReceipt
        )
          return false;
        clearedAt = cleanup.clearedAt ?? new Date();
      } else {
        if (
          cleanup.state !== "clearing" ||
          request.cleanupReceiptSha256 !== expectedReceipt
        )
          return false;
        clearedAt = new Date();
        await transaction
          .updateTable("offline_scorm_cleanup_inventory")
          .set({
            state: "cleared",
            clearedAt,
            cleanupReceiptSha256: request.cleanupReceiptSha256,
            lastErrorCode: null,
            updatedAt: clearedAt,
          })
          .where("entitlementId", "=", request.entitlementId)
          .executeTakeFirstOrThrow();
      }
      const [remainingCleanup, activeEntitlement] = await Promise.all([
        transaction
          .selectFrom("offline_scorm_cleanup_inventory")
          .select("id")
          .where("installationId", "=", cleanup.installationId)
          .where("entitlementId", "!=", request.entitlementId)
          .where("state", "!=", "cleared")
          .executeTakeFirst(),
        transaction
          .selectFrom("offline_learning_entitlement")
          .select("id")
          .where("installationId", "=", cleanup.installationId)
          .where("status", "=", "active")
          .executeTakeFirst(),
      ]);
      if (!remainingCleanup && !activeEntitlement)
        await transaction
          .updateTable("offline_learning_installation")
          .set({
            status: "revoked",
            endedAt: clearedAt,
            updatedAt: clearedAt,
          })
          .where("id", "=", cleanup.installationId)
          .where("userId", "=", user.id)
          .where("status", "=", "active")
          .executeTakeFirst();
      return true;
    });
  if (!updated) return { status: "denied" };
  logServerEvent({
    level: "info",
    event: "scorm.offline_package_cleared",
    fields: {
      actorUserId: user.id,
      entityType: "offline_learning_entitlement",
      entityId: request.entitlementId,
    },
  });
  return { status: "cleared" };
}
