import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";
import { lockActiveOfflineScormSession } from "#/server/scorm/offline-scorm-auth-lifecycle.server";
import {
  issueOfflineScormEntitlementInTransaction,
  type OfflineScormEntitlementIssueResult,
} from "#/server/scorm/offline-scorm-entitlement.server";
import type { OfflineScormEntitlementSigner } from "#/server/scorm/offline-scorm-entitlement-signing.server";
import {
  lockOrCreateScormAttempt,
  resolveScormLaunchPolicy,
  type ScormLaunchPolicyDenial,
} from "#/server/scorm/scorm-launch-policy.server";

type CourseTarget = {
  kind: "course";
  enrollmentId: string;
  modulePosition: number;
};

type ExpectedPackage = {
  packageVersionId: string;
  packageSha256: string;
};

type CloudFrontPreparationState =
  "allocating" | "binding_pending" | "enabling" | "needs_attention";

type CloudFrontEntitlementDenial =
  | ScormLaunchPolicyDenial
  | "installation-unavailable"
  | "finite-access-expiry-required"
  | "offline-writer-active"
  | "package-inventory-unavailable"
  | "reservation-unavailable"
  | "session-unavailable";

export type OfflineScormCloudFrontReservationResult =
  | {
      status: "preparing";
      entitlementId: string;
      state: CloudFrontPreparationState;
      recovered: boolean;
    }
  | { status: "denied"; reason: CloudFrontEntitlementDenial };

export type OfflineScormCloudFrontFinalizationResult =
  | {
      status: "preparing";
      entitlementId: string;
      state: CloudFrontPreparationState;
    }
  | {
      status: "ready";
      issuance: Extract<
        OfflineScormEntitlementIssueResult,
        { status: "issued" }
      >;
    }
  | { status: "denied"; reason: CloudFrontEntitlementDenial };

type CloudFrontAllocation = Selectable<
  Database["offline_scorm_cloudfront_allocation"]
>;

function reservationMatches(
  allocation: CloudFrontAllocation,
  input: {
    userId: string;
    installationId: string;
    attemptId: string;
    target: CourseTarget;
    courseVersionItemId: string;
    expectedPackage: ExpectedPackage;
  },
): boolean {
  return (
    allocation.userId === input.userId &&
    allocation.installationId === input.installationId &&
    allocation.attemptId === input.attemptId &&
    allocation.courseEnrollmentId === input.target.enrollmentId &&
    allocation.courseModulePosition === input.target.modulePosition &&
    allocation.courseVersionItemId === input.courseVersionItemId &&
    allocation.scormPackageVersionId ===
      input.expectedPackage.packageVersionId &&
    allocation.packageSha256 === input.expectedPackage.packageSha256
  );
}

async function lockActiveInstallation(
  transaction: Parameters<typeof lockActiveOfflineScormSession>[0],
  input: { installationId: string; userId: string },
) {
  return await transaction
    .selectFrom("offline_learning_installation")
    .select("id")
    .where("id", "=", input.installationId)
    .where("userId", "=", input.userId)
    .where("status", "=", "active")
    .forUpdate()
    .executeTakeFirst();
}

/**
 * Reserves one disabled CloudFront distribution for an authorized Course SCO.
 * No entitlement is signed and writer ownership remains online while AWS binds
 * the provider-owned origin.
 */
export async function reserveOfflineScormCloudFrontEntitlement(
  input: {
    target: CourseTarget;
    installationId: string;
    sessionId: string;
    expectedPackage: ExpectedPackage;
  },
  user: AuthenticatedUser,
): Promise<OfflineScormCloudFrontReservationResult> {
  const result = await getDatabase()
    .transaction()
    .execute(
      async (transaction): Promise<OfflineScormCloudFrontReservationResult> => {
        if (
          !(await lockActiveOfflineScormSession(transaction, {
            sessionId: input.sessionId,
            userId: user.id,
          }))
        )
          return { status: "denied", reason: "session-unavailable" };
        if (
          !(await lockActiveInstallation(transaction, {
            installationId: input.installationId,
            userId: user.id,
          }))
        )
          return { status: "denied", reason: "installation-unavailable" };

        const now = new Date();
        const policy = await resolveScormLaunchPolicy(
          transaction,
          input.target,
          user.id,
          now,
        );
        if (policy.status === "denied") return policy;
        if (!policy.intendedLaunchExpiresAt)
          return { status: "denied", reason: "finite-access-expiry-required" };
        if (
          policy.packageVersionId !== input.expectedPackage.packageVersionId ||
          policy.packageSha256 !== input.expectedPackage.packageSha256
        )
          return { status: "denied", reason: "package-inventory-unavailable" };
        if (policy.offering.kind !== "course")
          throw new Error(
            "CloudFront Course reservation resolved another offering",
          );

        const attempt = await lockOrCreateScormAttempt(transaction, policy);
        const existing = await transaction
          .selectFrom("offline_scorm_cloudfront_allocation")
          .selectAll()
          .where("attemptId", "=", attempt.id)
          .where("userId", "is not", null)
          .where("state", "!=", "deleted")
          .forUpdate()
          .executeTakeFirst();
        if (existing) {
          if (
            !reservationMatches(existing, {
              userId: user.id,
              installationId: input.installationId,
              attemptId: attempt.id,
              target: input.target,
              courseVersionItemId: policy.offering.courseVersionItemId,
              expectedPackage: input.expectedPackage,
            })
          )
            return { status: "denied", reason: "reservation-unavailable" };
          if (
            ![
              "allocating",
              "binding_pending",
              "enabling",
              "needs_attention",
            ].includes(existing.state) ||
            (existing.state === "needs_attention" &&
              !["allocating", "enabling"].includes(
                existing.recoveryState ?? "",
              ))
          )
            return { status: "denied", reason: "reservation-unavailable" };
          return {
            status: "preparing",
            entitlementId: existing.entitlementId,
            state: existing.state as CloudFrontPreparationState,
            recovered: true,
          };
        }
        if (attempt.writerMode === "offline")
          return { status: "denied", reason: "offline-writer-active" };

        const entitlementId = randomUUID();
        await transaction
          .insertInto("offline_scorm_cloudfront_allocation")
          .values({
            entitlementId,
            userId: user.id,
            installationId: input.installationId,
            attemptId: attempt.id,
            courseEnrollmentId: input.target.enrollmentId,
            courseModulePosition: input.target.modulePosition,
            courseVersionItemId: policy.offering.courseVersionItemId,
            scormPackageVersionId: policy.packageVersionId,
            packageSha256: policy.packageSha256,
            distributionId: null,
            distributionDomain: null,
            recoveryState: null,
            lastErrorCode: null,
            allocationStartedAt: now,
            boundAt: null,
            enableRequestedAt: null,
            activatedAt: null,
            disableRequestedAt: null,
            disabledAt: null,
            deletionRequestedAt: null,
            deletedAt: null,
            availableAt: now,
            leasedUntil: null,
            lastAttemptAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .executeTakeFirstOrThrow();
        return {
          status: "preparing",
          entitlementId,
          state: "allocating",
          recovered: false,
        };
      },
    );
  if (result.status === "preparing")
    logServerEvent({
      level: "info",
      event: result.recovered
        ? "scorm.offline_cloudfront_reservation_recovered"
        : "scorm.offline_cloudfront_reservation_created",
      fields: {
        actorUserId: user.id,
        entityType: "offline_scorm_cloudfront_allocation",
        entityId: result.entitlementId,
        state: result.state,
      },
    });
  return result;
}

/**
 * Creates the signed entitlement and cleanup authority in the same transaction
 * that promotes a bound reservation to enabling. The envelope remains server
 * side until CloudFront is active.
 */
export async function finalizeOfflineScormCloudFrontEntitlement(
  input: {
    entitlementId: string;
    target: CourseTarget;
    installationId: string;
    sessionId: string;
    expectedPackage: ExpectedPackage;
  },
  user: AuthenticatedUser,
  signEntitlement: OfflineScormEntitlementSigner,
): Promise<OfflineScormCloudFrontFinalizationResult> {
  const result = await getDatabase()
    .transaction()
    .execute(
      async (
        transaction,
      ): Promise<
        | OfflineScormCloudFrontFinalizationResult
        | (Extract<OfflineScormEntitlementIssueResult, { status: "issued" }> & {
            allocationState: "enabling" | "active" | "needs_attention";
            recovered: boolean;
          })
      > => {
        if (
          !(await lockActiveOfflineScormSession(transaction, {
            sessionId: input.sessionId,
            userId: user.id,
          }))
        )
          return { status: "denied", reason: "session-unavailable" };
        if (
          !(await lockActiveInstallation(transaction, {
            installationId: input.installationId,
            userId: user.id,
          }))
        )
          return { status: "denied", reason: "installation-unavailable" };

        const allocation = await transaction
          .selectFrom("offline_scorm_cloudfront_allocation")
          .selectAll()
          .where("entitlementId", "=", input.entitlementId)
          .where("userId", "=", user.id)
          .where("installationId", "=", input.installationId)
          .where("courseEnrollmentId", "=", input.target.enrollmentId)
          .where("courseModulePosition", "=", input.target.modulePosition)
          .forUpdate()
          .executeTakeFirst();
        if (!allocation)
          return { status: "denied", reason: "reservation-unavailable" };
        if (
          allocation.state === "allocating" ||
          (allocation.state === "needs_attention" &&
            allocation.recoveryState === "allocating")
        )
          return {
            status: "preparing",
            entitlementId: allocation.entitlementId,
            state: allocation.state,
          };
        if (
          allocation.state === "needs_attention" &&
          allocation.recoveryState !== "enabling"
        )
          return { status: "denied", reason: "reservation-unavailable" };
        if (
          ![
            "binding_pending",
            "enabling",
            "active",
            "needs_attention",
          ].includes(allocation.state) ||
          !allocation.distributionDomain ||
          !allocation.attemptId ||
          !allocation.courseVersionItemId
        )
          return { status: "denied", reason: "reservation-unavailable" };
        const distributionDomain = allocation.distributionDomain;

        const issuance = await issueOfflineScormEntitlementInTransaction(
          transaction,
          {
            target: input.target,
            installationId: input.installationId,
            sessionId: input.sessionId,
          },
          user,
          signEntitlement,
          ({ attemptId, policy }) => {
            if (
              allocation.state !== "binding_pending" ||
              policy.offering.kind !== "course" ||
              !reservationMatches(allocation, {
                userId: user.id,
                installationId: input.installationId,
                attemptId,
                target: input.target,
                courseVersionItemId: policy.offering.courseVersionItemId,
                expectedPackage: input.expectedPackage,
              })
            )
              throw new Error(
                "CloudFront reservation changed before entitlement issuance",
              );
            return {
              entitlementId: allocation.entitlementId,
              packageSiteOrigin: `https://${distributionDomain}`,
              afterAuthorityCreated: async (lockedTransaction, issuedAt) => {
                const promoted = await lockedTransaction
                  .updateTable("offline_scorm_cloudfront_allocation")
                  .set({
                    state: "enabling",
                    enableRequestedAt: issuedAt,
                    availableAt: issuedAt,
                    leasedUntil: null,
                    updatedAt: issuedAt,
                  })
                  .where("entitlementId", "=", allocation.entitlementId)
                  .where("state", "=", "binding_pending")
                  .executeTakeFirstOrThrow();
                if (promoted.numUpdatedRows !== 1n)
                  throw new Error(
                    "CloudFront reservation could not enter enabling",
                  );
              },
            };
          },
          input.expectedPackage,
        );
        if (issuance.status === "denied") return issuance;
        const issuedOffering = issuance.envelope.entitlement.offering;
        if (
          issuedOffering.kind !== "course" ||
          !reservationMatches(allocation, {
            userId: user.id,
            installationId: input.installationId,
            attemptId: issuance.attemptId,
            target: input.target,
            courseVersionItemId: issuedOffering.courseVersionItemId,
            expectedPackage: input.expectedPackage,
          })
        )
          throw new Error(
            "Issued CloudFront entitlement does not match its reservation",
          );
        if (issuance.recovered && allocation.state === "binding_pending")
          throw new Error(
            "CloudFront binding has entitlement authority without activation evidence",
          );
        const allocationState = issuance.recovered
          ? allocation.state === "active"
            ? "active"
            : allocation.state === "needs_attention"
              ? "needs_attention"
              : "enabling"
          : "enabling";
        return { ...issuance, allocationState };
      },
    );

  if (result.status !== "issued") return result;
  const { allocationState, recovered, ...issuance } = result;
  logServerEvent({
    level: "info",
    event: recovered
      ? "scorm.offline_cloudfront_entitlement_recovered"
      : "scorm.offline_cloudfront_entitlement_issued",
    fields: {
      actorUserId: user.id,
      entityType: "offline_learning_entitlement",
      entityId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      allocationState,
    },
  });
  return allocationState === "active"
    ? { status: "ready", issuance }
    : {
        status: "preparing",
        entitlementId: issuance.entitlementId,
        state: allocationState,
      };
}
