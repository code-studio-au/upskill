import "@tanstack/react-start/server-only";

import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  canonicalizeOfflineScormCommit,
  offlineScormReconciliationBatchSchema,
  type OfflineScormOfferingBinding,
  type OfflineScormSignedCommit,
} from "#/features/scorm/offline-scorm-reconciliation";
import type { ScormProgressInput } from "#/features/scorm/scorm.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  deriveScormCompletion,
  lockScormProgressOwner,
  type LockedScormProgressOwner,
} from "#/server/scorm/scorm-progress-transaction.server";

type ReceiptOutcome = "accepted" | "rejected" | "conflict";

interface OfflineScormReceiptResult {
  commitId: string;
  clientSequence: number;
  requestFingerprint: string;
  outcome: ReceiptOutcome;
  reasonCode: string;
  resultingAttemptRevision: number | null;
  receivedAt: string;
  recovered: boolean;
}

interface OfflineScormAuthoritativeSnapshot {
  attemptId: string;
  progressRevision: number;
  status: "not_started" | "in_progress" | "completed" | "abandoned";
  lessonStatus: ScormProgressInput["lessonStatus"];
  location: string;
  suspendData: string;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  totalTimeSeconds: number;
  completedAt: string | null;
}

export type OfflineScormReconciliationResult =
  | {
      status: "denied";
      reason:
        | "entitlement_unavailable"
        | "installation_key_invalid"
        | "signature_invalid";
    }
  | {
      status: "conflict";
      reason: "commit_id_reused";
      commitId: string;
      clientSequence: number;
      acknowledged: false;
    }
  | {
      status: "processed";
      receipts: OfflineScormReceiptResult[];
      authoritative: OfflineScormAuthoritativeSnapshot;
      block:
        | null
        | {
            kind: "sequence_gap";
            commitId: string;
            clientSequence: number;
            expectedSequence: number;
            acknowledged: false;
          }
        | {
            kind: "terminal_receipt";
            commitId: string;
            clientSequence: number;
            reasonCode: string;
            acknowledged: true;
          };
      remainingCommitCount: number;
    };

interface PreparedCommit {
  commit: OfflineScormSignedCommit;
  canonical: string;
  fingerprint: string;
}

interface LockedAttempt {
  id: string;
  enrollmentId: string | null;
  modulePosition: number | null;
  eventParticipationId: string | null;
  eventTemplateVersionItemId: string | null;
  scormPackageVersionId: string;
  status: OfflineScormAuthoritativeSnapshot["status"];
  lessonStatus: ScormProgressInput["lessonStatus"];
  location: string;
  suspendData: string;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  totalTimeSeconds: number;
  startedAt: Date | null;
  completedAt: Date | null;
  progressRevision: number;
  writerMode: "online" | "offline";
  credentialGeneration: number;
  offlineEntitlementId: string | null;
}

function requestFingerprint(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function verifyInstallationKey(input: {
  publicKeySpki: Uint8Array;
  publicKeySha256: string;
}): ReturnType<typeof createPublicKey> | undefined {
  const spki = Buffer.from(input.publicKeySpki);
  if (createHash("sha256").update(spki).digest("hex") !== input.publicKeySha256)
    return undefined;
  try {
    const publicKey = createPublicKey({
      key: spki,
      format: "der",
      type: "spki",
    });
    if (
      publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return undefined;
    return publicKey;
  } catch {
    return undefined;
  }
}

function receiptResult(
  receipt: {
    commitId: string;
    clientSequence: number;
    requestFingerprint: string;
    outcome: ReceiptOutcome;
    reasonCode: string;
    resultingAttemptRevision: number | null;
    receivedAt: Date;
  },
  recovered: boolean,
): OfflineScormReceiptResult {
  return {
    ...receipt,
    receivedAt: receipt.receivedAt.toISOString(),
    recovered,
  };
}

function authoritativeSnapshot(
  attempt: LockedAttempt,
): OfflineScormAuthoritativeSnapshot {
  return {
    attemptId: attempt.id,
    progressRevision: attempt.progressRevision,
    status: attempt.status,
    lessonStatus: attempt.lessonStatus,
    location: attempt.location,
    suspendData: attempt.suspendData,
    scoreRaw: attempt.scoreRaw,
    scoreMin: attempt.scoreMin,
    scoreMax: attempt.scoreMax,
    totalTimeSeconds: attempt.totalTimeSeconds,
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}

async function resolveOfferingBinding(
  transaction: Transaction<Database>,
  owner: LockedScormProgressOwner,
  attempt: LockedAttempt,
): Promise<OfflineScormOfferingBinding | undefined> {
  if (owner.kind === "course") {
    if (attempt.modulePosition === null) return undefined;
    const item = await transaction
      .selectFrom("course_version_item")
      .select("id")
      .where("courseVersionId", "=", owner.courseVersionId)
      .where("modulePosition", "=", attempt.modulePosition)
      .where("kind", "=", "scorm")
      .where("learningActivityVersionId", "=", attempt.scormPackageVersionId)
      .executeTakeFirst();
    return item
      ? {
          kind: "course",
          enrollmentId: owner.enrollmentId,
          courseVersionItemId: item.id,
        }
      : undefined;
  }
  if (!attempt.eventTemplateVersionItemId) return undefined;
  const item = await transaction
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .innerJoin("event_template_version_item as item", (join) =>
      join
        .onRef(
          "item.eventTemplateVersionId",
          "=",
          "occurrence.eventTemplateVersionId",
        )
        .on("item.id", "=", attempt.eventTemplateVersionItemId),
    )
    .select("item.id")
    .where("participation.id", "=", owner.eventParticipationId)
    .where("item.kind", "=", "scorm")
    .where("item.learningActivityVersionId", "=", attempt.scormPackageVersionId)
    .executeTakeFirst();
  return item
    ? {
        kind: "event",
        eventParticipationId: owner.eventParticipationId,
        eventTemplateVersionItemId: item.id,
      }
    : undefined;
}

function offeringMatches(
  actual: OfflineScormOfferingBinding | undefined,
  supplied: OfflineScormOfferingBinding,
): boolean {
  if (!actual || actual.kind !== supplied.kind) return false;
  if (actual.kind === "course") {
    if (supplied.kind !== "course") return false;
    return (
      actual.enrollmentId === supplied.enrollmentId &&
      actual.courseVersionItemId === supplied.courseVersionItemId
    );
  }
  if (supplied.kind !== "event") return false;
  return (
    actual.eventParticipationId === supplied.eventParticipationId &&
    actual.eventTemplateVersionItemId === supplied.eventTemplateVersionItemId
  );
}

async function insertTerminalReceipt(
  transaction: Transaction<Database>,
  input: {
    entitlementId: string;
    attemptId: string;
    prepared: PreparedCommit;
    outcome: Exclude<ReceiptOutcome, "accepted">;
    reasonCode: string;
    now: Date;
  },
): Promise<OfflineScormReceiptResult> {
  const receipt = {
    id: `offline_scorm_receipt_${randomUUID()}`,
    entitlementId: input.entitlementId,
    attemptId: input.attemptId,
    commitId: input.prepared.commit.commitId,
    clientSequence: input.prepared.commit.clientSequence,
    requestFingerprint: input.prepared.fingerprint,
    launchSessionId: input.prepared.commit.launchSessionId,
    sessionElapsedSeconds: input.prepared.commit.sessionElapsedSeconds,
    sessionTimeDeltaSeconds: input.prepared.commit.sessionTimeDeltaSeconds,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    resultingAttemptRevision: null,
    receivedAt: input.now,
  } as const;
  await transaction
    .insertInto("offline_scorm_reconciliation_receipt")
    .values(receipt)
    .executeTakeFirstOrThrow();
  return receiptResult(receipt, false);
}

function terminalBlock(receipt: OfflineScormReceiptResult) {
  return {
    kind: "terminal_receipt" as const,
    commitId: receipt.commitId,
    clientSequence: receipt.clientSequence,
    reasonCode: receipt.reasonCode,
    acknowledged: true as const,
  };
}

function lifecycleReason(status: string): string {
  switch (status) {
    case "hard_revoked":
      return "entitlement_hard_revoked";
    case "replaced":
      return "entitlement_replaced";
    default:
      return "entitlement_resolved";
  }
}

/**
 * Reconciles one exact entitlement journal. This boundary remains deliberately
 * unreachable from HTTP until the trusted local runtime and activation slices
 * can satisfy the complete storage, signing and cleanup protocol.
 */
export async function reconcileOfflineScormProgress(
  input: unknown,
  user: AuthenticatedUser,
): Promise<OfflineScormReconciliationResult> {
  const batch = offlineScormReconciliationBatchSchema.parse(input);
  const database = getDatabase();
  const authority = await database
    .selectFrom("offline_learning_entitlement as entitlement")
    .innerJoin(
      "offline_learning_installation as installation",
      "installation.id",
      "entitlement.installationId",
    )
    .select([
      "entitlement.attemptId",
      "installation.publicKeySpki",
      "installation.publicKeySha256",
    ])
    .where("entitlement.id", "=", batch.entitlementId)
    .where("entitlement.userId", "=", user.id)
    .executeTakeFirst();
  if (!authority)
    return { status: "denied", reason: "entitlement_unavailable" };
  const publicKey = verifyInstallationKey(authority);
  if (!publicKey)
    return { status: "denied", reason: "installation_key_invalid" };

  const prepared = batch.commits
    .map((commit): PreparedCommit => {
      const canonical = canonicalizeOfflineScormCommit(commit);
      return {
        commit,
        canonical,
        fingerprint: requestFingerprint(canonical),
      };
    })
    .toSorted(
      (left, right) => left.commit.clientSequence - right.commit.clientSequence,
    );
  if (
    prepared.some(
      ({ commit, canonical }) =>
        !verifySignature(
          "sha256",
          Buffer.from(canonical, "utf8"),
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(commit.signature, "base64url"),
        ),
    )
  )
    return { status: "denied", reason: "signature_invalid" };

  const existingReceipts = await database
    .selectFrom("offline_scorm_reconciliation_receipt")
    .select([
      "commitId",
      "clientSequence",
      "requestFingerprint",
      "outcome",
      "reasonCode",
      "resultingAttemptRevision",
      "receivedAt",
    ])
    .where("entitlementId", "=", batch.entitlementId)
    .where(
      "commitId",
      "in",
      prepared.map(({ commit }) => commit.commitId),
    )
    .execute();
  const existingByCommitId = new Map(
    existingReceipts.map((receipt) => [receipt.commitId, receipt]),
  );
  for (const entry of prepared) {
    const existing = existingByCommitId.get(entry.commit.commitId);
    if (existing && existing.requestFingerprint !== entry.fingerprint)
      return {
        status: "conflict",
        reason: "commit_id_reused",
        commitId: entry.commit.commitId,
        clientSequence: entry.commit.clientSequence,
        acknowledged: false,
      };
  }
  if (existingReceipts.length === prepared.length) {
    const attempt = await database
      .selectFrom("scorm_attempt")
      .select([
        "id",
        "enrollmentId",
        "modulePosition",
        "eventParticipationId",
        "eventTemplateVersionItemId",
        "scormPackageVersionId",
        "status",
        "lessonStatus",
        "location",
        "suspendData",
        "scoreRaw",
        "scoreMin",
        "scoreMax",
        "totalTimeSeconds",
        "startedAt",
        "completedAt",
        "progressRevision",
        "writerMode",
        "credentialGeneration",
        "offlineEntitlementId",
      ])
      .where("id", "=", authority.attemptId)
      .executeTakeFirstOrThrow();
    const receipts = prepared.map(({ commit }) => {
      const receipt = existingByCommitId.get(commit.commitId);
      if (!receipt)
        throw new Error("Offline SCORM receipt recovery invariant failed");
      return receiptResult(receipt, true);
    });
    const terminal = receipts.find((receipt) => receipt.outcome !== "accepted");
    return {
      status: "processed",
      receipts,
      authoritative: authoritativeSnapshot(attempt),
      block: terminal ? terminalBlock(terminal) : null,
      remainingCommitCount: 0,
    };
  }

  const result = await database.transaction().execute(async (transaction) => {
    const identity = await transaction
      .selectFrom("scorm_attempt")
      .select(["enrollmentId", "eventParticipationId"])
      .where("id", "=", authority.attemptId)
      .executeTakeFirstOrThrow();
    // Launch, online progress and issuance all lock the owner before the
    // attempt. Reconciliation preserves that order, then serializes on the
    // entitlement before it locks and changes the attempt.
    const owner = await lockScormProgressOwner(transaction, identity);
    if (!owner) throw new Error("Offline SCORM progress owner is unavailable");
    const entitlement = await transaction
      .selectFrom("offline_learning_entitlement")
      .selectAll()
      .where("id", "=", batch.entitlementId)
      .where("userId", "=", user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const lockedReceipts = await transaction
      .selectFrom("offline_scorm_reconciliation_receipt")
      .select([
        "commitId",
        "clientSequence",
        "requestFingerprint",
        "outcome",
        "reasonCode",
        "resultingAttemptRevision",
        "receivedAt",
      ])
      .where("entitlementId", "=", entitlement.id)
      .where(
        "commitId",
        "in",
        prepared.map(({ commit }) => commit.commitId),
      )
      .execute();
    const lockedReceiptByCommitId = new Map(
      lockedReceipts.map((receipt) => [receipt.commitId, receipt]),
    );
    for (const entry of prepared) {
      const existing = lockedReceiptByCommitId.get(entry.commit.commitId);
      if (existing && existing.requestFingerprint !== entry.fingerprint)
        return {
          status: "conflict",
          reason: "commit_id_reused",
          commitId: entry.commit.commitId,
          clientSequence: entry.commit.clientSequence,
          acknowledged: false,
        } as const;
    }
    let attempt: LockedAttempt = await transaction
      .selectFrom("scorm_attempt")
      .select([
        "id",
        "enrollmentId",
        "modulePosition",
        "eventParticipationId",
        "eventTemplateVersionItemId",
        "scormPackageVersionId",
        "status",
        "lessonStatus",
        "location",
        "suspendData",
        "scoreRaw",
        "scoreMin",
        "scoreMax",
        "totalTimeSeconds",
        "startedAt",
        "completedAt",
        "progressRevision",
        "writerMode",
        "credentialGeneration",
        "offlineEntitlementId",
      ])
      .where("id", "=", entitlement.attemptId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const offering = await resolveOfferingBinding(transaction, owner, attempt);
    const receipts: OfflineScormReceiptResult[] = [];
    let block: Extract<
      OfflineScormReconciliationResult,
      { status: "processed" }
    >["block"] = null;
    let highestSequence = entitlement.highestContiguousSequence;
    let cursorRevision = entitlement.reconciliationCursorRevision;
    let processedCount = 0;

    for (const entry of prepared) {
      const { commit } = entry;
      const existing = lockedReceiptByCommitId.get(commit.commitId);
      if (existing) {
        const recovered = receiptResult(existing, true);
        receipts.push(recovered);
        processedCount += 1;
        if (recovered.outcome !== "accepted") {
          block = terminalBlock(recovered);
          break;
        }
        continue;
      }

      const now = new Date();
      const bindingMatches =
        commit.entitlementId === entitlement.id &&
        commit.attemptId === entitlement.attemptId &&
        commit.packageVersionId === entitlement.scormPackageVersionId &&
        commit.packageSha256 === entitlement.packageSha256 &&
        commit.runtimeVersion === entitlement.runtimeVersion &&
        offeringMatches(offering, commit.offering);
      if (!bindingMatches) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "binding_mismatch",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }
      if (entitlement.status !== "active") {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "rejected",
          reasonCode: lifecycleReason(entitlement.status),
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }
      if (now > entitlement.commitAcceptanceDeadline) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "rejected",
          reasonCode: "acceptance_deadline_expired",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }
      if (
        attempt.status === "abandoned" ||
        attempt.writerMode !== "offline" ||
        attempt.offlineEntitlementId !== entitlement.id ||
        attempt.credentialGeneration !== entitlement.writerGeneration
      ) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "writer_conflict",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }

      const expectedSequence = highestSequence + 1;
      if (commit.clientSequence > expectedSequence) {
        block = {
          kind: "sequence_gap",
          commitId: commit.commitId,
          clientSequence: commit.clientSequence,
          expectedSequence,
          acknowledged: false,
        };
        break;
      }
      if (commit.clientSequence < expectedSequence) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "sequence_already_consumed",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }
      if (commit.historyBaseRevision !== entitlement.historyBaseRevision) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "history_base_mismatch",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }
      if (
        attempt.progressRevision !== cursorRevision ||
        (highestSequence === 0 &&
          attempt.progressRevision !== entitlement.historyBaseRevision)
      ) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "server_revision_conflict",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }

      const sessionHighWater = await transaction
        .selectFrom("offline_scorm_reconciliation_receipt")
        .select(
          sql<number>`coalesce(max("sessionElapsedSeconds"), 0)::integer`.as(
            "seconds",
          ),
        )
        .where("entitlementId", "=", entitlement.id)
        .where("launchSessionId", "=", commit.launchSessionId)
        .where("outcome", "=", "accepted")
        .executeTakeFirstOrThrow();
      const expectedSessionDelta =
        commit.sessionElapsedSeconds - sessionHighWater.seconds;
      if (commit.sessionTimeDeltaSeconds !== expectedSessionDelta) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "session_time_delta_mismatch",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }

      const nextTotalTimeSeconds =
        attempt.totalTimeSeconds + commit.sessionTimeDeltaSeconds;
      if (
        nextTotalTimeSeconds > 31_536_000 ||
        commit.snapshot.totalTimeSeconds !== nextTotalTimeSeconds
      ) {
        const receipt = await insertTerminalReceipt(transaction, {
          entitlementId: entitlement.id,
          attemptId: entitlement.attemptId,
          prepared: entry,
          outcome: "conflict",
          reasonCode: "total_time_mismatch",
          now,
        });
        receipts.push(receipt);
        processedCount += 1;
        block = terminalBlock(receipt);
        break;
      }

      const suppliedCompletion =
        commit.snapshot.lessonStatus === "completed" ||
        commit.snapshot.lessonStatus === "passed";
      const completionIsMonotonic =
        attempt.status === "completed" && !suppliedCompletion;
      const nextStatus =
        attempt.status === "completed" || suppliedCompletion
          ? "completed"
          : "in_progress";
      const nextLessonStatus = completionIsMonotonic
        ? attempt.lessonStatus
        : commit.snapshot.lessonStatus;
      const nextCompletedAt =
        nextStatus === "completed" ? (attempt.completedAt ?? now) : null;
      const materiallyChanged =
        attempt.status !== nextStatus ||
        attempt.lessonStatus !== nextLessonStatus ||
        attempt.location !== commit.snapshot.location ||
        attempt.suspendData !== commit.snapshot.suspendData ||
        attempt.scoreRaw !== commit.snapshot.scoreRaw ||
        attempt.scoreMin !== commit.snapshot.scoreMin ||
        attempt.scoreMax !== commit.snapshot.scoreMax ||
        attempt.totalTimeSeconds !== nextTotalTimeSeconds ||
        attempt.completedAt?.getTime() !== nextCompletedAt?.getTime();
      const resultingRevision =
        attempt.progressRevision + (materiallyChanged ? 1 : 0);

      await transaction
        .updateTable("offline_learning_entitlement")
        .set({
          highestContiguousSequence: commit.clientSequence,
          reconciliationCursorRevision: resultingRevision,
        })
        .where("id", "=", entitlement.id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("scorm_attempt")
        .set({
          status: nextStatus,
          lessonStatus: nextLessonStatus,
          location: commit.snapshot.location,
          suspendData: commit.snapshot.suspendData,
          scoreRaw: commit.snapshot.scoreRaw,
          scoreMin: commit.snapshot.scoreMin,
          scoreMax: commit.snapshot.scoreMax,
          totalTimeSeconds: nextTotalTimeSeconds,
          startedAt: attempt.startedAt ?? now,
          lastActivityAt: now,
          completedAt: nextCompletedAt,
          progressRevision: resultingRevision,
          updatedAt: now,
        })
        .where("id", "=", attempt.id)
        .executeTakeFirstOrThrow();
      if (suppliedCompletion)
        await deriveScormCompletion(
          transaction,
          owner,
          attempt.eventTemplateVersionItemId,
          now,
        );

      const receipt = {
        id: `offline_scorm_receipt_${randomUUID()}`,
        entitlementId: entitlement.id,
        attemptId: entitlement.attemptId,
        commitId: commit.commitId,
        clientSequence: commit.clientSequence,
        requestFingerprint: entry.fingerprint,
        launchSessionId: commit.launchSessionId,
        sessionElapsedSeconds: commit.sessionElapsedSeconds,
        sessionTimeDeltaSeconds: commit.sessionTimeDeltaSeconds,
        outcome: "accepted" as const,
        reasonCode: "accepted",
        resultingAttemptRevision: resultingRevision,
        receivedAt: now,
      };
      await transaction
        .insertInto("offline_scorm_reconciliation_receipt")
        .values(receipt)
        .executeTakeFirstOrThrow();
      receipts.push(receiptResult(receipt, false));
      processedCount += 1;
      highestSequence = commit.clientSequence;
      cursorRevision = resultingRevision;
      attempt = {
        ...attempt,
        status: nextStatus,
        lessonStatus: nextLessonStatus,
        location: commit.snapshot.location,
        suspendData: commit.snapshot.suspendData,
        scoreRaw: commit.snapshot.scoreRaw,
        scoreMin: commit.snapshot.scoreMin,
        scoreMax: commit.snapshot.scoreMax,
        totalTimeSeconds: nextTotalTimeSeconds,
        startedAt: attempt.startedAt ?? now,
        completedAt: nextCompletedAt,
        progressRevision: resultingRevision,
      };
    }

    return {
      status: "processed",
      receipts,
      authoritative: authoritativeSnapshot(attempt),
      block,
      remainingCommitCount: prepared.length - processedCount,
    } as const;
  });

  if (result.status === "processed")
    logServerEvent({
      level: "info",
      event: "scorm.offline_progress_reconciled",
      fields: {
        actorUserId: user.id,
        entityType: "offline_learning_entitlement",
        entityId: batch.entitlementId,
        aggregateId: result.authoritative.attemptId,
        affectedCount: result.receipts.length,
        ...(result.block
          ? {
              reasonCode:
                result.block.kind === "terminal_receipt"
                  ? result.block.reasonCode
                  : result.block.kind,
            }
          : {}),
      },
    });
  return result;
}
