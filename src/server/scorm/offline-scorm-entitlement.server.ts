import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import {
  canonicalizeOfflineScormEntitlementEnvelope,
  offlineScormSignedEntitlementEnvelopeSchema,
  type OfflineScormSignedEntitlementEnvelope,
} from "#/features/scorm/offline-scorm-entitlement";
import { assertOfflineScormPackageOriginIsolation } from "#/features/scorm/offline-scorm-package-site";
import { offlineScormTrustedEntitlementSchema } from "#/features/scorm/offline-scorm-trusted-runtime";
import type { OfflineScormOfferingBinding } from "#/features/scorm/offline-scorm-reconciliation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  lockOrCreateScormAttempt,
  lockExistingScormAttempt,
  resolveScormLaunchPolicy,
  type ScormLaunchPolicyDenial,
  type ScormLaunchTarget,
} from "#/server/scorm/scorm-launch-policy.server";
import { addElapsedMilliseconds } from "#/server/time/time.server";
import type { OfflineScormEntitlementSigner } from "#/server/scorm/offline-scorm-entitlement-signing.server";
import type { OfflineScormPackageSiteProvisioner } from "#/server/scorm/offline-scorm-package-site.server";
import { lockActiveOfflineScormSession } from "#/server/scorm/offline-scorm-auth-lifecycle.server";

const OFFLINE_SCORM_RUNTIME_VERSION = "offline-scorm-1";
const MAXIMUM_ACCEPTANCE_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;

function offeringsMatch(
  left: OfflineScormOfferingBinding,
  right: OfflineScormOfferingBinding,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "course")
    return (
      right.kind === "course" &&
      left.enrollmentId === right.enrollmentId &&
      left.courseVersionItemId === right.courseVersionItemId
    );
  return (
    right.kind === "event" &&
    left.eventParticipationId === right.eventParticipationId &&
    left.eventTemplateVersionItemId === right.eventTemplateVersionItemId
  );
}

export type OfflineScormEntitlementIssueResult =
  | {
      status: "issued";
      entitlementId: string;
      attemptId: string;
      historyBaseRevision: number;
      writerGeneration: number;
      packageVersionId: string;
      packageSha256: string;
      packageSiteOrigin: string;
      runtimeVersion: string;
      issuedAt: Date;
      intendedLaunchExpiresAt: Date;
      commitAcceptanceDeadline: Date;
      envelope: OfflineScormSignedEntitlementEnvelope;
    }
  | {
      status: "denied";
      reason:
        | ScormLaunchPolicyDenial
        | "installation-unavailable"
        | "finite-access-expiry-required"
        | "offline-writer-active"
        | "package-inventory-unavailable"
        | "session-unavailable";
    };

type RecoveredOfflineScormEntitlement = Extract<
  OfflineScormEntitlementIssueResult,
  { status: "issued" }
> & { recovered: true };

async function recoverActiveOfflineScormEntitlement(
  transaction: Transaction<Database>,
  input: {
    target: ScormLaunchTarget;
    installation: { id: string; publicKeySha256: string };
    userId: string;
  },
): Promise<RecoveredOfflineScormEntitlement | undefined> {
  let courseVersionId: string | undefined;
  if (input.target.kind === "course") {
    const enrollment = await transaction
      .selectFrom("enrollment")
      .select("courseVersionId")
      .where("id", "=", input.target.enrollmentId)
      .where("userId", "=", input.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!enrollment) return undefined;
    courseVersionId = enrollment.courseVersionId;
  } else {
    const participation = await transaction
      .selectFrom("event_participation")
      .select("id")
      .where("id", "=", input.target.eventParticipationId)
      .where("userId", "=", input.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!participation) return undefined;
  }

  const attempt = await lockExistingScormAttempt(transaction, input.target);
  if (attempt?.writerMode !== "offline" || !attempt.offlineEntitlementId)
    return undefined;

  const existing = await transaction
    .selectFrom("offline_learning_entitlement")
    .select([
      "id",
      "attemptId",
      "installationId",
      "userId",
      "scormPackageVersionId",
      "packageSha256",
      "runtimeVersion",
      "historyBaseRevision",
      "writerGeneration",
      "issuedAt",
      "intendedLaunchExpiresAt",
      "commitAcceptanceDeadline",
      "signedEnvelope",
    ])
    .where("id", "=", attempt.offlineEntitlementId)
    .where("attemptId", "=", attempt.id)
    .where("installationId", "=", input.installation.id)
    .where("userId", "=", input.userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!existing?.signedEnvelope) return undefined;

  const cleanupInventory = await transaction
    .selectFrom("offline_scorm_cleanup_inventory")
    .select(["packageSiteOrigin", "state"])
    .where("entitlementId", "=", existing.id)
    .where("installationId", "=", existing.installationId)
    .where("userId", "=", existing.userId)
    .executeTakeFirst();
  if (!cleanupInventory || cleanupInventory.state !== "pending")
    throw new Error(
      "Active offline SCORM entitlement has no pending cleanup inventory",
    );
  const environment = getServerEnv();
  assertOfflineScormPackageOriginIsolation({
    applicationOrigin: environment.APP_ORIGIN,
    learningOrigin: environment.LEARNING_ORIGIN,
    packageOrigin: cleanupInventory.packageSiteOrigin,
  });

  let expectedOffering: OfflineScormOfferingBinding | undefined;
  if (input.target.kind === "course") {
    if (courseVersionId === undefined)
      throw new Error("Offline SCORM recovery owner is unavailable");
    const item = await transaction
      .selectFrom("course_version_item")
      .select("id")
      .where("courseVersionId", "=", courseVersionId)
      .where("kind", "=", "scorm")
      .where("modulePosition", "=", input.target.modulePosition)
      .where("learningActivityVersionId", "=", existing.scormPackageVersionId)
      .executeTakeFirst();
    if (item)
      expectedOffering = {
        kind: "course",
        enrollmentId: input.target.enrollmentId,
        courseVersionItemId: item.id,
      };
  } else
    expectedOffering = {
      kind: "event",
      eventParticipationId: input.target.eventParticipationId,
      eventTemplateVersionItemId: input.target.eventTemplateVersionItemId,
    };
  const envelope = offlineScormSignedEntitlementEnvelopeSchema.parse(
    existing.signedEnvelope,
  );
  const signed = envelope.entitlement;
  if (
    !expectedOffering ||
    !offeringsMatch(signed.offering, expectedOffering) ||
    attempt.credentialGeneration !== existing.writerGeneration ||
    signed.entitlementId !== existing.id ||
    signed.attemptId !== existing.attemptId ||
    signed.installationId !== existing.installationId ||
    signed.learnerId !== existing.userId ||
    signed.devicePublicKeySha256 !== input.installation.publicKeySha256 ||
    signed.packageVersionId !== existing.scormPackageVersionId ||
    signed.packageSha256 !== existing.packageSha256 ||
    signed.runtimeVersion !== existing.runtimeVersion ||
    signed.historyBaseRevision !== existing.historyBaseRevision ||
    signed.issuedAt !== existing.issuedAt.toISOString() ||
    signed.intendedLaunchExpiresAt !==
      existing.intendedLaunchExpiresAt.toISOString() ||
    signed.commitAcceptanceDeadline !==
      existing.commitAcceptanceDeadline.toISOString()
  )
    throw new Error(
      "Stored offline SCORM envelope does not match its entitlement",
    );

  return {
    status: "issued",
    entitlementId: existing.id,
    attemptId: existing.attemptId,
    historyBaseRevision: existing.historyBaseRevision,
    writerGeneration: existing.writerGeneration,
    packageVersionId: existing.scormPackageVersionId,
    packageSha256: existing.packageSha256,
    packageSiteOrigin: cleanupInventory.packageSiteOrigin,
    runtimeVersion: existing.runtimeVersion,
    issuedAt: existing.issuedAt,
    intendedLaunchExpiresAt: existing.intendedLaunchExpiresAt,
    commitAcceptanceDeadline: existing.commitAcceptanceDeadline,
    envelope,
    recovered: true,
  };
}

/**
 * Establishes the exclusive offline writer and signs its exact initial state.
 * The activated Course boundary supplies the immutable package precondition;
 * Event acquisition remains unreachable.
 */
export async function issueOfflineScormEntitlement(
  input: {
    target: ScormLaunchTarget;
    installationId: string;
    sessionId: string;
  },
  user: AuthenticatedUser,
  signEntitlement: OfflineScormEntitlementSigner,
  provisionPackageSite: OfflineScormPackageSiteProvisioner,
  expectedPackage?: { packageVersionId: string; packageSha256: string },
): Promise<OfflineScormEntitlementIssueResult> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      if (
        !(await lockActiveOfflineScormSession(transaction, {
          sessionId: input.sessionId,
          userId: user.id,
          now: new Date(),
        }))
      )
        return { status: "denied", reason: "session-unavailable" } as const;
      const installation = await transaction
        .selectFrom("offline_learning_installation")
        .select(["id", "publicKeySha256"])
        .where("id", "=", input.installationId)
        .where("userId", "=", user.id)
        .where("status", "=", "active")
        .forUpdate()
        .executeTakeFirst();
      if (!installation)
        return {
          status: "denied",
          reason: "installation-unavailable",
        } as const;

      // A lost-response retry replays the already-issued authority. Mutable
      // access policy only governs creating a fresh offline delegation.
      const recovered = await recoverActiveOfflineScormEntitlement(
        transaction,
        {
          target: input.target,
          installation,
          userId: user.id,
        },
      );
      if (recovered) {
        if (
          expectedPackage &&
          (recovered.packageVersionId !== expectedPackage.packageVersionId ||
            recovered.packageSha256 !== expectedPackage.packageSha256)
        )
          return {
            status: "denied",
            reason: "package-inventory-unavailable",
          } as const;
        return recovered;
      }

      const issuedAt = new Date();
      const policy = await resolveScormLaunchPolicy(
        transaction,
        input.target,
        user.id,
        issuedAt,
      );
      if (policy.status === "denied") return policy;
      if (!policy.intendedLaunchExpiresAt)
        return {
          status: "denied",
          reason: "finite-access-expiry-required",
        } as const;
      if (
        expectedPackage &&
        (policy.packageVersionId !== expectedPackage.packageVersionId ||
          policy.packageSha256 !== expectedPackage.packageSha256)
      )
        return {
          status: "denied",
          reason: "package-inventory-unavailable",
        } as const;

      const attempt = await lockOrCreateScormAttempt(transaction, policy);
      if (attempt.writerMode === "offline")
        return {
          status: "denied",
          reason: "offline-writer-active",
        } as const;

      const entitlementId = randomUUID();
      const packageSiteOrigin = provisionPackageSite({
        attemptId: attempt.id,
        entitlementId,
      });
      const environment = getServerEnv();
      assertOfflineScormPackageOriginIsolation({
        applicationOrigin: environment.APP_ORIGIN,
        learningOrigin: environment.LEARNING_ORIGIN,
        packageOrigin: packageSiteOrigin,
      });
      const writerGeneration = attempt.credentialGeneration + 1;
      const commitAcceptanceDeadline = addElapsedMilliseconds(
        policy.intendedLaunchExpiresAt,
        MAXIMUM_ACCEPTANCE_DELAY_MS,
      );
      const entitlement = offlineScormTrustedEntitlementSchema.parse({
        schemaVersion: 1,
        entitlementId,
        attemptId: attempt.id,
        installationId: installation.id,
        learnerId: user.id,
        devicePublicKeySha256: installation.publicKeySha256,
        historyBaseRevision: attempt.progressRevision,
        runtimeVersion: OFFLINE_SCORM_RUNTIME_VERSION,
        offering: policy.offering,
        packageVersionId: policy.packageVersionId,
        packageSha256: policy.packageSha256,
        initialSnapshot: {
          lessonStatus: attempt.lessonStatus,
          location: attempt.location,
          suspendData: attempt.suspendData,
          scoreRaw: attempt.scoreRaw,
          scoreMin: attempt.scoreMin,
          scoreMax: attempt.scoreMax,
          totalTimeSeconds: attempt.totalTimeSeconds,
        },
        issuedAt: issuedAt.toISOString(),
        intendedLaunchExpiresAt: policy.intendedLaunchExpiresAt.toISOString(),
        commitAcceptanceDeadline: commitAcceptanceDeadline.toISOString(),
      });
      const envelope = signEntitlement(entitlement);
      const signedCanonical = canonicalizeOfflineScormEntitlementEnvelope({
        schemaVersion: envelope.schemaVersion,
        algorithm: envelope.algorithm,
        signingKeyId: envelope.signingKeyId,
        entitlement: envelope.entitlement,
      });
      const intendedCanonical = canonicalizeOfflineScormEntitlementEnvelope({
        schemaVersion: envelope.schemaVersion,
        algorithm: envelope.algorithm,
        signingKeyId: envelope.signingKeyId,
        entitlement,
      });
      if (signedCanonical !== intendedCanonical)
        throw new Error("Offline SCORM signer changed the entitlement payload");
      await transaction
        .insertInto("offline_learning_entitlement")
        .values({
          id: entitlementId,
          userId: user.id,
          attemptId: attempt.id,
          installationId: installation.id,
          scormPackageVersionId: policy.packageVersionId,
          packageSha256: policy.packageSha256,
          runtimeVersion: OFFLINE_SCORM_RUNTIME_VERSION,
          historyBaseRevision: attempt.progressRevision,
          writerGeneration,
          reconciliationCursorRevision: attempt.progressRevision,
          signedEnvelope: JSON.stringify(envelope),
          resolution: null,
          resolvedByUserId: null,
          issuedAt,
          intendedLaunchExpiresAt: policy.intendedLaunchExpiresAt,
          commitAcceptanceDeadline,
          endedAt: null,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("offline_scorm_cleanup_inventory")
        .values({
          id: randomUUID(),
          entitlementId,
          installationId: installation.id,
          userId: user.id,
          packageSiteOrigin,
          clearRequestedAt: null,
          clearedAt: null,
          cleanupReceiptSha256: null,
          lastErrorCode: null,
          createdAt: issuedAt,
          updatedAt: issuedAt,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("scorm_attempt_session")
        .set({ revokedAt: issuedAt })
        .where("attemptId", "=", attempt.id)
        .where("revokedAt", "is", null)
        .execute();
      await transaction
        .updateTable("scorm_attempt")
        .set({
          writerMode: "offline",
          offlineEntitlementId: entitlementId,
          credentialGeneration: writerGeneration,
          updatedAt: issuedAt,
        })
        .where("id", "=", attempt.id)
        .executeTakeFirstOrThrow();

      return {
        status: "issued",
        entitlementId,
        attemptId: attempt.id,
        historyBaseRevision: attempt.progressRevision,
        writerGeneration,
        packageVersionId: policy.packageVersionId,
        packageSha256: policy.packageSha256,
        packageSiteOrigin,
        runtimeVersion: OFFLINE_SCORM_RUNTIME_VERSION,
        issuedAt,
        intendedLaunchExpiresAt: policy.intendedLaunchExpiresAt,
        commitAcceptanceDeadline,
        envelope,
        recovered: false,
      } as const;
    });

  if (result.status === "issued") {
    const { recovered, ...response } = result;
    logServerEvent({
      level: "info",
      event: recovered
        ? "scorm.offline_writer_recovered"
        : "scorm.offline_writer_issued",
      fields: {
        actorUserId: user.id,
        entityType: "offline_learning_entitlement",
        entityId: result.entitlementId,
        attemptId: result.attemptId,
      },
    });
    return response;
  }
  return result;
}
