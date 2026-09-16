import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
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

const OFFLINE_SCORM_RUNTIME_VERSION = "offline-scorm-1";
const MAXIMUM_ACCEPTANCE_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;

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
 * Establishes the exclusive offline writer, but is deliberately not connected
 * to a route. A later activated slice must add signed response material and the
 * complete download/runtime boundary before a learner can invoke it.
 */
export async function issueOfflineScormEntitlement(
  input: {
    target: ScormLaunchTarget;
    installationId: string;
  },
  user: AuthenticatedUser,
): Promise<OfflineScormEntitlementIssueResult> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const installation = await transaction
        .selectFrom("offline_learning_installation")
        .select("id")
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
      if (attempt.writerMode === "offline")
        return {
          status: "denied",
          reason: "offline-writer-active",
        } as const;

      const entitlementId = randomUUID();
      const writerGeneration = attempt.credentialGeneration + 1;
      const commitAcceptanceDeadline = addElapsedMilliseconds(
        policy.intendedLaunchExpiresAt,
        MAXIMUM_ACCEPTANCE_DELAY_MS,
      );
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
      } as const;
    });

  if (result.status === "issued")
    logServerEvent({
      level: "info",
      event: "scorm.offline_writer_issued",
      fields: {
        actorUserId: user.id,
        entityType: "offline_learning_entitlement",
        entityId: result.entitlementId,
        attemptId: result.attemptId,
      },
    });
  return result;
}
