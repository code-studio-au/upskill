import "@tanstack/react-start/server-only";

import { sql, type Kysely } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { addElapsedMilliseconds } from "#/server/time/time.server";
import {
  OfflineScormCloudFrontProviderError,
  type OfflineScormCloudFrontProvider,
} from "./offline-scorm-cloudfront-provider.server";

const WORK_LEASE_MILLISECONDS = 3 * 60 * 1_000;
const RETRY_BASE_MILLISECONDS = 30 * 1_000;
const RETRY_MAX_MILLISECONDS = 15 * 60 * 1_000;
const MAXIMUM_FAILURES = 10;
const DEFAULT_BATCH_SIZE = 10;

type ProviderOperation =
  "allocating" | "enabling" | "disabling" | "deletion_pending";

type OfflineScormCloudFrontAllocationOutcome =
  | { status: "promoted"; entitlementId: string }
  | { status: "bound"; entitlementId: string; distributionId: string }
  | { status: "waiting"; entitlementId: string; operation: ProviderOperation }
  | { status: "active"; entitlementId: string; distributionId: string }
  | { status: "stale"; entitlementId: string; operation: ProviderOperation }
  | {
      status: "retirement_requested";
      entitlementId: string;
      operation: "enabling" | "active";
      reasonCode: "activation_authority_absent" | "cleanup_terminal";
    }
  | {
      status: "deletion_pending";
      entitlementId: string;
      distributionId: string;
    }
  | { status: "deleted"; entitlementId: string; distributionId: string }
  | {
      status: "needs_attention";
      entitlementId: string;
      operation: ProviderOperation;
      reasonCode: string;
    };

export interface OfflineScormCloudFrontAllocationBatch {
  outcomes: OfflineScormCloudFrontAllocationOutcome[];
  limitReached: boolean;
}

interface ClaimedProviderWork {
  entitlementId: string;
  operation: ProviderOperation;
  distributionId: string | null;
  distributionDomain: string | null;
  failureCount: number;
  leaseVersion: number;
  leasedUntil: Date;
}

type ClaimedProviderWorkResult =
  | { kind: "work"; work: ClaimedProviderWork }
  | {
      kind: "outcome";
      outcome: OfflineScormCloudFrontAllocationOutcome;
    };

function retryAt(now: Date, failureCount: number): Date {
  const delay = Math.min(
    RETRY_BASE_MILLISECONDS * 2 ** Math.max(failureCount - 1, 0),
    RETRY_MAX_MILLISECONDS,
  );
  return addElapsedMilliseconds(now, delay);
}

function providerFailureCode(error: unknown): string {
  if (error instanceof OfflineScormCloudFrontProviderError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  )
    return "distribution_binding_conflict";
  return "allocator_unexpected_error";
}

async function hasActivationAuthority(
  database: Kysely<Database>,
  entitlementId: string,
  distributionDomain: string,
): Promise<boolean> {
  const authority = await database
    .selectFrom("offline_learning_entitlement as entitlement")
    .innerJoin(
      "offline_scorm_cleanup_inventory as cleanup",
      "cleanup.entitlementId",
      "entitlement.id",
    )
    .select("entitlement.id")
    .where("entitlement.id", "=", entitlementId)
    .where("entitlement.status", "=", "active")
    .where("cleanup.state", "=", "pending")
    .where("cleanup.packageSiteOrigin", "=", `https://${distributionDomain}`)
    .forUpdate()
    .executeTakeFirst();
  return authority !== undefined;
}

async function requestActivationRetirement(
  database: Kysely<Database>,
  entitlementId: string,
  now: Date,
): Promise<OfflineScormCloudFrontAllocationOutcome> {
  await database
    .updateTable("offline_scorm_cloudfront_allocation")
    .set({
      state: "disabling",
      disableRequestedAt: now,
      attempts: 0,
      availableAt: now,
      leasedUntil: null,
      updatedAt: now,
    })
    .where("entitlementId", "=", entitlementId)
    .where("state", "=", "enabling")
    .executeTakeFirstOrThrow();
  return {
    status: "retirement_requested",
    entitlementId,
    operation: "enabling",
    reasonCode: "activation_authority_absent",
  };
}

async function promoteReadyRetirement(
  database: Kysely<Database>,
  now: Date,
): Promise<OfflineScormCloudFrontAllocationOutcome | undefined> {
  return await database.transaction().execute(async (transaction) => {
    const allocation = await transaction
      .selectFrom("offline_scorm_cloudfront_allocation as allocation")
      .innerJoin(
        "offline_learning_entitlement as entitlement",
        "entitlement.id",
        "allocation.entitlementId",
      )
      .innerJoin(
        "offline_scorm_cleanup_inventory as cleanup",
        "cleanup.entitlementId",
        "allocation.entitlementId",
      )
      .select("allocation.entitlementId")
      .where("allocation.state", "=", "active")
      .where((expression) =>
        expression.or([
          expression("entitlement.status", "in", ["replaced", "hard_revoked"]),
          expression.and([
            expression("entitlement.status", "=", "active"),
            expression("cleanup.state", "in", ["needs_attention", "cleared"]),
          ]),
          expression.and([
            expression("entitlement.status", "=", "resolved"),
            expression("cleanup.state", "in", ["needs_attention", "cleared"]),
          ]),
        ]),
      )
      .orderBy("allocation.availableAt")
      .orderBy("allocation.updatedAt")
      .orderBy("allocation.entitlementId")
      .forUpdate(["allocation", "entitlement", "cleanup"])
      .skipLocked()
      .executeTakeFirst();
    if (!allocation) return undefined;
    const updated = await transaction
      .updateTable("offline_scorm_cloudfront_allocation")
      .set({
        state: "disabling",
        disableRequestedAt: now,
        attempts: 0,
        availableAt: now,
        leasedUntil: null,
        updatedAt: now,
      })
      .where("entitlementId", "=", allocation.entitlementId)
      .where("state", "=", "active")
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) return undefined;
    return {
      status: "retirement_requested",
      entitlementId: allocation.entitlementId,
      operation: "active",
      reasonCode: "cleanup_terminal",
    };
  });
}

async function promoteReadyBinding(
  database: Kysely<Database>,
  now: Date,
): Promise<OfflineScormCloudFrontAllocationOutcome | undefined> {
  return await database.transaction().execute(async (transaction) => {
    const allocation = await transaction
      .selectFrom("offline_scorm_cloudfront_allocation as allocation")
      .innerJoin(
        "offline_learning_entitlement as entitlement",
        "entitlement.id",
        "allocation.entitlementId",
      )
      .innerJoin(
        "offline_scorm_cleanup_inventory as cleanup",
        "cleanup.entitlementId",
        "allocation.entitlementId",
      )
      .select(["allocation.entitlementId", "allocation.distributionDomain"])
      .where("allocation.state", "=", "binding_pending")
      .where("allocation.availableAt", "<=", now)
      .where("entitlement.status", "=", "active")
      .where("cleanup.state", "=", "pending")
      .where(
        sql<boolean>`cleanup."packageSiteOrigin" =
          'https://' || allocation."distributionDomain"`,
      )
      .orderBy("allocation.availableAt")
      .orderBy("allocation.entitlementId")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!allocation?.distributionDomain) return undefined;
    const updated = await transaction
      .updateTable("offline_scorm_cloudfront_allocation")
      .set({
        state: "enabling",
        enableRequestedAt: now,
        availableAt: now,
        updatedAt: now,
      })
      .where("entitlementId", "=", allocation.entitlementId)
      .where("state", "=", "binding_pending")
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) return undefined;
    return { status: "promoted", entitlementId: allocation.entitlementId };
  });
}

async function claimProviderWork(
  database: Kysely<Database>,
  now: Date,
): Promise<ClaimedProviderWorkResult | undefined> {
  return await database.transaction().execute(async (transaction) => {
    const allocation = await transaction
      .selectFrom("offline_scorm_cloudfront_allocation")
      .select([
        "entitlementId",
        "state",
        "recoveryState",
        "distributionId",
        "distributionDomain",
        "attempts",
        "leaseVersion",
      ])
      .where((expression) =>
        expression.or([
          expression("state", "in", [
            "allocating",
            "enabling",
            "disabling",
            "deletion_pending",
          ]),
          expression.and([
            expression("state", "=", "needs_attention"),
            expression("recoveryState", "in", [
              "allocating",
              "enabling",
              "disabling",
              "deletion_pending",
            ]),
          ]),
        ]),
      )
      .where("attempts", "<", MAXIMUM_FAILURES)
      .where("availableAt", "<=", now)
      .where((expression) =>
        expression.or([
          expression("leasedUntil", "is", null),
          expression("leasedUntil", "<", now),
        ]),
      )
      .orderBy("availableAt")
      .orderBy("updatedAt")
      .orderBy("entitlementId")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!allocation) return undefined;
    const operation =
      allocation.state === "needs_attention"
        ? allocation.recoveryState
        : allocation.state;
    if (
      operation !== "allocating" &&
      operation !== "enabling" &&
      operation !== "disabling" &&
      operation !== "deletion_pending"
    )
      throw new Error("CloudFront allocation recovery state is invalid");
    const leaseVersion = allocation.leaseVersion + 1;
    const leasedUntil = addElapsedMilliseconds(now, WORK_LEASE_MILLISECONDS);
    await transaction
      .updateTable("offline_scorm_cloudfront_allocation")
      .set({
        state: operation,
        recoveryState: null,
        lastErrorCode: null,
        leaseVersion,
        leasedUntil,
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where("entitlementId", "=", allocation.entitlementId)
      .executeTakeFirstOrThrow();
    if (operation === "enabling") {
      if (
        !allocation.distributionDomain ||
        !(await hasActivationAuthority(
          transaction,
          allocation.entitlementId,
          allocation.distributionDomain,
        ))
      )
        return {
          kind: "outcome",
          outcome: await requestActivationRetirement(
            transaction,
            allocation.entitlementId,
            now,
          ),
        };
    }
    return {
      kind: "work",
      work: {
        entitlementId: allocation.entitlementId,
        operation,
        distributionId: allocation.distributionId,
        distributionDomain: allocation.distributionDomain,
        failureCount: allocation.attempts,
        leaseVersion,
        leasedUntil,
      },
    };
  });
}

async function markExhaustedWork(
  database: Kysely<Database>,
  now: Date,
): Promise<OfflineScormCloudFrontAllocationOutcome | undefined> {
  return await database.transaction().execute(async (transaction) => {
    const allocation = await transaction
      .selectFrom("offline_scorm_cloudfront_allocation")
      .select(["entitlementId", "state", "recoveryState", "distributionDomain"])
      .where((expression) =>
        expression.or([
          expression("state", "in", [
            "allocating",
            "enabling",
            "disabling",
            "deletion_pending",
          ]),
          expression.and([
            expression("state", "=", "needs_attention"),
            expression("recoveryState", "in", [
              "allocating",
              "enabling",
              "disabling",
              "deletion_pending",
            ]),
          ]),
        ]),
      )
      .where("attempts", ">=", MAXIMUM_FAILURES)
      .where((expression) =>
        expression.or([
          expression("state", "!=", "needs_attention"),
          expression("lastErrorCode", "!=", "allocator_attempts_exhausted"),
        ]),
      )
      .where("availableAt", "<=", now)
      .where((expression) =>
        expression.or([
          expression("leasedUntil", "is", null),
          expression("leasedUntil", "<", now),
        ]),
      )
      .orderBy("availableAt")
      .orderBy("updatedAt")
      .orderBy("entitlementId")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!allocation) return undefined;
    const operation =
      allocation.state === "needs_attention"
        ? allocation.recoveryState
        : allocation.state;
    if (
      operation !== "allocating" &&
      operation !== "enabling" &&
      operation !== "disabling" &&
      operation !== "deletion_pending"
    )
      throw new Error("CloudFront exhausted work state is invalid");
    if (
      operation === "enabling" &&
      (!allocation.distributionDomain ||
        !(await hasActivationAuthority(
          transaction,
          allocation.entitlementId,
          allocation.distributionDomain,
        )))
    ) {
      if (allocation.state === "needs_attention")
        await transaction
          .updateTable("offline_scorm_cloudfront_allocation")
          .set({
            state: "enabling",
            recoveryState: null,
            lastErrorCode: null,
            leasedUntil: null,
            updatedAt: now,
          })
          .where("entitlementId", "=", allocation.entitlementId)
          .where("state", "=", "needs_attention")
          .executeTakeFirstOrThrow();
      return await requestActivationRetirement(
        transaction,
        allocation.entitlementId,
        now,
      );
    }
    const reasonCode = "allocator_attempts_exhausted";
    const updated = await transaction
      .updateTable("offline_scorm_cloudfront_allocation")
      .set({
        state: "needs_attention",
        recoveryState: operation,
        lastErrorCode: reasonCode,
        availableAt: now,
        leasedUntil: null,
        updatedAt: now,
      })
      .where("entitlementId", "=", allocation.entitlementId)
      .where("state", "=", allocation.state)
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) return undefined;
    return {
      status: "needs_attention",
      entitlementId: allocation.entitlementId,
      operation,
      reasonCode,
    };
  });
}

async function finishProviderFailure(
  database: Kysely<Database>,
  work: ClaimedProviderWork,
  now: Date,
  reasonCode: string,
): Promise<OfflineScormCloudFrontAllocationOutcome> {
  return await database.transaction().execute(async (transaction) => {
    const allocation = await transaction
      .selectFrom("offline_scorm_cloudfront_allocation")
      .select(["distributionDomain"])
      .where("entitlementId", "=", work.entitlementId)
      .where("state", "=", work.operation)
      .where("leaseVersion", "=", work.leaseVersion)
      .where("leasedUntil", "=", work.leasedUntil)
      .forUpdate()
      .executeTakeFirst();
    if (!allocation)
      return {
        status: "stale",
        entitlementId: work.entitlementId,
        operation: work.operation,
      };
    if (
      work.operation === "enabling" &&
      (!allocation.distributionDomain ||
        !(await hasActivationAuthority(
          transaction,
          work.entitlementId,
          allocation.distributionDomain,
        )))
    )
      return await requestActivationRetirement(
        transaction,
        work.entitlementId,
        now,
      );
    const failureCount = work.failureCount + 1;
    await transaction
      .updateTable("offline_scorm_cloudfront_allocation")
      .set({
        state: "needs_attention",
        recoveryState: work.operation,
        lastErrorCode: reasonCode,
        attempts: failureCount,
        availableAt: retryAt(now, failureCount),
        leasedUntil: null,
        updatedAt: now,
      })
      .where("entitlementId", "=", work.entitlementId)
      .where("state", "=", work.operation)
      .where("leaseVersion", "=", work.leaseVersion)
      .where("leasedUntil", "=", work.leasedUntil)
      .executeTakeFirstOrThrow();
    return {
      status: "needs_attention",
      entitlementId: work.entitlementId,
      operation: work.operation,
      reasonCode,
    };
  });
}

async function executeProviderWork(
  database: Kysely<Database>,
  provider: OfflineScormCloudFrontProvider,
  work: ClaimedProviderWork,
  now: Date,
): Promise<OfflineScormCloudFrontAllocationOutcome> {
  try {
    if (work.operation === "allocating") {
      const response = await provider.allocate(work.entitlementId);
      const distributionDomain = new URL(response.packageSiteOrigin).hostname;
      const updated = await database
        .updateTable("offline_scorm_cloudfront_allocation")
        .set({
          distributionId: response.distributionId,
          distributionDomain,
          state: "binding_pending",
          boundAt: now,
          attempts: 0,
          availableAt: now,
          leasedUntil: null,
          updatedAt: now,
        })
        .where("entitlementId", "=", work.entitlementId)
        .where("state", "=", "allocating")
        .where("leaseVersion", "=", work.leaseVersion)
        .where("leasedUntil", "=", work.leasedUntil)
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n)
        return {
          status: "stale",
          entitlementId: work.entitlementId,
          operation: work.operation,
        };
      return {
        status: "bound",
        entitlementId: work.entitlementId,
        distributionId: response.distributionId,
      };
    }
    if (!work.distributionId || !work.distributionDomain)
      throw new Error("CloudFront provider work has no immutable binding");
    const distributionId = work.distributionId;
    const distributionDomain = work.distributionDomain;
    if (work.operation === "enabling") {
      const response = await provider.activate(
        work.entitlementId,
        distributionId,
      );
      if (
        response.distributionId !== distributionId ||
        new URL(response.packageSiteOrigin).hostname !== distributionDomain
      )
        throw new Error("CloudFront allocator response changed its binding");
      return await database.transaction().execute(async (transaction) => {
        const allocation = await transaction
          .selectFrom("offline_scorm_cloudfront_allocation")
          .select(["distributionDomain"])
          .where("entitlementId", "=", work.entitlementId)
          .where("state", "=", "enabling")
          .where("leaseVersion", "=", work.leaseVersion)
          .where("leasedUntil", "=", work.leasedUntil)
          .forUpdate()
          .executeTakeFirst();
        if (!allocation)
          return {
            status: "stale",
            entitlementId: work.entitlementId,
            operation: work.operation,
          };
        if (
          !allocation.distributionDomain ||
          !(await hasActivationAuthority(
            transaction,
            work.entitlementId,
            allocation.distributionDomain,
          ))
        )
          return await requestActivationRetirement(
            transaction,
            work.entitlementId,
            now,
          );
        if (response.phase === "active") {
          await transaction
            .updateTable("offline_scorm_cloudfront_allocation")
            .set({
              state: "active",
              activatedAt: now,
              attempts: 0,
              availableAt: now,
              leasedUntil: null,
              updatedAt: now,
            })
            .where("entitlementId", "=", work.entitlementId)
            .where("state", "=", "enabling")
            .where("leaseVersion", "=", work.leaseVersion)
            .where("leasedUntil", "=", work.leasedUntil)
            .executeTakeFirstOrThrow();
          return {
            status: "active",
            entitlementId: work.entitlementId,
            distributionId,
          };
        }
        await transaction
          .updateTable("offline_scorm_cloudfront_allocation")
          .set({
            availableAt: addElapsedMilliseconds(now, RETRY_BASE_MILLISECONDS),
            leasedUntil: null,
            updatedAt: now,
          })
          .where("entitlementId", "=", work.entitlementId)
          .where("state", "=", "enabling")
          .where("leaseVersion", "=", work.leaseVersion)
          .where("leasedUntil", "=", work.leasedUntil)
          .executeTakeFirstOrThrow();
        return {
          status: "waiting",
          entitlementId: work.entitlementId,
          operation: work.operation,
        };
      });
    }

    const response = await provider.retire(work.entitlementId, distributionId);
    if (response.distributionId !== distributionId)
      throw new Error("CloudFront allocator response changed its binding");
    if (
      response.phase !== "deleted" &&
      new URL(response.packageSiteOrigin).hostname !== distributionDomain
    )
      throw new Error("CloudFront allocator response changed its binding");
    return await database.transaction().execute(async (transaction) => {
      const allocation = await transaction
        .selectFrom("offline_scorm_cloudfront_allocation")
        .select("entitlementId")
        .where("entitlementId", "=", work.entitlementId)
        .where("state", "=", work.operation)
        .where("leaseVersion", "=", work.leaseVersion)
        .where("leasedUntil", "=", work.leasedUntil)
        .forUpdate()
        .executeTakeFirst();
      if (!allocation)
        return {
          status: "stale",
          entitlementId: work.entitlementId,
          operation: work.operation,
        };
      if (response.phase === "deleted") {
        if (work.operation === "disabling") {
          await transaction
            .updateTable("offline_scorm_cloudfront_allocation")
            .set({
              state: "deletion_pending",
              disabledAt: now,
              deletionRequestedAt: now,
              attempts: 0,
              availableAt: now,
              leasedUntil: null,
              updatedAt: now,
            })
            .where("entitlementId", "=", work.entitlementId)
            .where("state", "=", "disabling")
            .where("leaseVersion", "=", work.leaseVersion)
            .where("leasedUntil", "=", work.leasedUntil)
            .executeTakeFirstOrThrow();
          return {
            status: "deletion_pending",
            entitlementId: work.entitlementId,
            distributionId,
          };
        }
        await transaction
          .updateTable("offline_scorm_cloudfront_allocation")
          .set({
            state: "deleted",
            deletedAt: now,
            attempts: 0,
            availableAt: now,
            leasedUntil: null,
            updatedAt: now,
          })
          .where("entitlementId", "=", work.entitlementId)
          .where("state", "=", "deletion_pending")
          .where("leaseVersion", "=", work.leaseVersion)
          .where("leasedUntil", "=", work.leasedUntil)
          .executeTakeFirstOrThrow();
        return {
          status: "deleted",
          entitlementId: work.entitlementId,
          distributionId,
        };
      }
      await transaction
        .updateTable("offline_scorm_cloudfront_allocation")
        .set({
          availableAt: addElapsedMilliseconds(now, RETRY_BASE_MILLISECONDS),
          leasedUntil: null,
          updatedAt: now,
        })
        .where("entitlementId", "=", work.entitlementId)
        .where("state", "=", work.operation)
        .where("leaseVersion", "=", work.leaseVersion)
        .where("leasedUntil", "=", work.leasedUntil)
        .executeTakeFirstOrThrow();
      return {
        status: "waiting",
        entitlementId: work.entitlementId,
        operation: work.operation,
      };
    });
  } catch (error) {
    const reasonCode = providerFailureCode(error);
    return await finishProviderFailure(database, work, now, reasonCode);
  }
}

async function processNextOfflineScormCloudFrontAllocation(
  provider: OfflineScormCloudFrontProvider | null,
  dependencies: {
    database?: Kysely<Database>;
    now?: () => Date;
  } = {},
): Promise<OfflineScormCloudFrontAllocationOutcome | undefined> {
  if (!provider) return undefined;
  const database = dependencies.database ?? getDatabase();
  const now = dependencies.now?.() ?? new Date();
  const retirement = await promoteReadyRetirement(database, now);
  if (retirement) return retirement;
  const promoted = await promoteReadyBinding(database, now);
  if (promoted) return promoted;
  const exhausted = await markExhaustedWork(database, now);
  if (exhausted) return exhausted;
  const claim = await claimProviderWork(database, now);
  if (!claim) return undefined;
  if (claim.kind === "outcome") return claim.outcome;
  return await executeProviderWork(database, provider, claim.work, now);
}

export async function processAvailableOfflineScormCloudFrontAllocations(
  provider: OfflineScormCloudFrontProvider | null,
  limit = DEFAULT_BATCH_SIZE,
  dependencies: {
    database?: Kysely<Database>;
    now?: () => Date;
  } = {},
): Promise<OfflineScormCloudFrontAllocationBatch> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("CloudFront allocation batch limit must be positive");
  const outcomes: OfflineScormCloudFrontAllocationOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextOfflineScormCloudFrontAllocation(
      provider,
      dependencies,
    );
    if (!outcome) return { outcomes, limitReached: false };
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: true };
}
