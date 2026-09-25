import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  canonicalizeOfflineScormEntitlementEnvelope,
  offlineScormSignedEntitlementEnvelopeSchema,
  type OfflineScormSignedEntitlementEnvelope,
} from "#/features/scorm/offline-scorm-entitlement";
import { offlineScormTrustedEntitlementSchema } from "#/features/scorm/offline-scorm-trusted-runtime";
import type { OfflineScormOfferingBinding } from "#/features/scorm/offline-scorm-reconciliation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  lockOrCreateScormAttempt,
  resolveScormLaunchPolicy,
  type ScormLaunchPolicyDenial,
  type ScormLaunchTarget,
} from "#/server/scorm/scorm-launch-policy.server";
import { addElapsedMilliseconds } from "#/server/time/time.server";
import type { OfflineScormEntitlementSigner } from "#/server/scorm/offline-scorm-entitlement-signing.server";

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
        | "offline-writer-active";
    };

/**
 * Establishes the exclusive offline writer and signs its exact initial state,
 * but is deliberately not connected to a route. A later activated slice must
 * add the complete download/runtime boundary before a learner can invoke it.
 */
export async function issueOfflineScormEntitlement(
  input: {
    target: ScormLaunchTarget;
    installationId: string;
  },
  user: AuthenticatedUser,
  signEntitlement: OfflineScormEntitlementSigner,
): Promise<OfflineScormEntitlementIssueResult> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
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

      const attempt = await lockOrCreateScormAttempt(transaction, policy);
      if (attempt.writerMode === "offline") {
        if (!attempt.offlineEntitlementId)
          throw new Error("Offline SCORM writer is missing its entitlement");
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
          .where("installationId", "=", installation.id)
          .where("userId", "=", user.id)
          .where("scormPackageVersionId", "=", policy.packageVersionId)
          .where("packageSha256", "=", policy.packageSha256)
          .where("status", "=", "active")
          .executeTakeFirst();
        if (!existing?.signedEnvelope)
          return {
            status: "denied",
            reason: "offline-writer-active",
          } as const;

        const envelope = offlineScormSignedEntitlementEnvelopeSchema.parse(
          existing.signedEnvelope,
        );
        const signed = envelope.entitlement;
        if (
          !offeringsMatch(signed.offering, policy.offering) ||
          signed.entitlementId !== existing.id ||
          signed.attemptId !== existing.attemptId ||
          signed.installationId !== existing.installationId ||
          signed.learnerId !== existing.userId ||
          signed.devicePublicKeySha256 !== installation.publicKeySha256 ||
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
          runtimeVersion: existing.runtimeVersion,
          issuedAt: existing.issuedAt,
          intendedLaunchExpiresAt: existing.intendedLaunchExpiresAt,
          commitAcceptanceDeadline: existing.commitAcceptanceDeadline,
          envelope,
          recovered: true,
        } as const;
      }

      const entitlementId = randomUUID();
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
