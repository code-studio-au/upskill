import { scormProgressInputSchema } from "#/features/scorm/scorm.schema";
import { instantIsoSchema } from "#/features/shared/time.schema";
import { z } from "#/validation/zod";

const OFFLINE_SCORM_COMMIT_CANONICAL_FORMAT = "upskill-offline-scorm-commit-v1";
const OFFLINE_SCORM_RECONCILIATION_BATCH_LIMIT = 16;

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );
const randomIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u));
const sha256Schema = z.string().check(z.regex(/^[a-f0-9]{64}$/u));
const boundedSecondsSchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(31_536_000));
const revisionSchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(2_147_483_647));
const canonicalInstantSchema = z.pipe(
  instantIsoSchema,
  z.transform((value) => new Date(value).toISOString()),
);

const offlineScormOfferingBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("course"),
    enrollmentId: internalIdSchema,
    courseVersionItemId: internalIdSchema,
  }),
  z.strictObject({
    kind: z.literal("event"),
    eventParticipationId: internalIdSchema,
    eventTemplateVersionItemId: internalIdSchema,
  }),
]);

const offlineScormUnsignedCommitShape = {
  schemaVersion: z.literal(1),
  entitlementId: internalIdSchema,
  attemptId: internalIdSchema,
  commitId: randomIdSchema,
  clientSequence: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(2_147_483_647)),
  historyBaseRevision: revisionSchema,
  runtimeVersion: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(100),
      z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    ),
  offering: offlineScormOfferingBindingSchema,
  packageVersionId: internalIdSchema,
  packageSha256: sha256Schema,
  reason: z.enum(["commit", "finish", "checkpoint", "pagehide"]),
  snapshot: scormProgressInputSchema,
  launchSessionId: randomIdSchema,
  sessionElapsedSeconds: boundedSecondsSchema,
  sessionTimeDeltaSeconds: boundedSecondsSchema,
  clientObservedAt: canonicalInstantSchema,
} as const;

export const offlineScormUnsignedCommitSchema = z
  .strictObject(offlineScormUnsignedCommitShape)
  .check(
    z.refine(
      (value) => value.sessionTimeDeltaSeconds <= value.sessionElapsedSeconds,
      {
        path: ["sessionTimeDeltaSeconds"],
        message: "Session time delta cannot exceed cumulative session time",
      },
    ),
  );

export const offlineScormSignedCommitSchema = z
  .strictObject({
    ...offlineScormUnsignedCommitShape,
    signature: z.string().check(z.length(86), z.regex(/^[A-Za-z0-9_-]+$/u)),
  })
  .check(
    z.refine(
      (value) => value.sessionTimeDeltaSeconds <= value.sessionElapsedSeconds,
      {
        path: ["sessionTimeDeltaSeconds"],
        message: "Session time delta cannot exceed cumulative session time",
      },
    ),
  );

export const offlineScormReconciliationBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    entitlementId: internalIdSchema,
    attemptId: internalIdSchema,
    commits: z
      .array(offlineScormSignedCommitSchema)
      .check(
        z.minLength(1),
        z.maxLength(OFFLINE_SCORM_RECONCILIATION_BATCH_LIMIT),
      ),
  })
  .check(
    z.superRefine((batch, context) => {
      const commitIds = new Set<string>();
      const sequences = new Set<number>();
      for (const [index, commit] of batch.commits.entries()) {
        if (
          commit.entitlementId !== batch.entitlementId ||
          commit.attemptId !== batch.attemptId
        )
          context.addIssue({
            code: "custom",
            path: ["commits", index],
            message:
              "Every commit must match the batch entitlement and attempt",
          });
        if (commitIds.has(commit.commitId))
          context.addIssue({
            code: "custom",
            path: ["commits", index, "commitId"],
            message: "Commit identifiers must be unique within a batch",
          });
        if (sequences.has(commit.clientSequence))
          context.addIssue({
            code: "custom",
            path: ["commits", index, "clientSequence"],
            message: "Client sequences must be unique within a batch",
          });
        commitIds.add(commit.commitId);
        sequences.add(commit.clientSequence);
      }
    }),
  );

export type OfflineScormOfferingBinding = z.infer<
  typeof offlineScormOfferingBindingSchema
>;
export type OfflineScormUnsignedCommit = z.infer<
  typeof offlineScormUnsignedCommitSchema
>;
export type OfflineScormSignedCommit = z.infer<
  typeof offlineScormSignedCommitSchema
>;
function normalizeNumber(value: number | null): number | null {
  return value === 0 ? 0 : value;
}

/**
 * Versioned fixed-position JSON tuple shared by the trusted browser runtime
 * and the server. Array positions are part of the v1 signature contract.
 */
export function canonicalizeOfflineScormCommit(
  input: OfflineScormUnsignedCommit | OfflineScormSignedCommit,
): string {
  const commit = offlineScormUnsignedCommitSchema.parse({
    schemaVersion: input.schemaVersion,
    entitlementId: input.entitlementId,
    attemptId: input.attemptId,
    commitId: input.commitId,
    clientSequence: input.clientSequence,
    historyBaseRevision: input.historyBaseRevision,
    runtimeVersion: input.runtimeVersion,
    offering: input.offering,
    packageVersionId: input.packageVersionId,
    packageSha256: input.packageSha256,
    reason: input.reason,
    snapshot: input.snapshot,
    launchSessionId: input.launchSessionId,
    sessionElapsedSeconds: input.sessionElapsedSeconds,
    sessionTimeDeltaSeconds: input.sessionTimeDeltaSeconds,
    clientObservedAt: input.clientObservedAt,
  });
  const offering =
    commit.offering.kind === "course"
      ? [
          "course",
          commit.offering.enrollmentId,
          commit.offering.courseVersionItemId,
        ]
      : [
          "event",
          commit.offering.eventParticipationId,
          commit.offering.eventTemplateVersionItemId,
        ];
  return JSON.stringify([
    OFFLINE_SCORM_COMMIT_CANONICAL_FORMAT,
    commit.schemaVersion,
    commit.entitlementId,
    commit.attemptId,
    commit.commitId,
    commit.clientSequence,
    commit.historyBaseRevision,
    commit.runtimeVersion,
    offering,
    commit.packageVersionId,
    commit.packageSha256,
    commit.reason,
    [
      commit.snapshot.lessonStatus,
      commit.snapshot.location,
      commit.snapshot.suspendData,
      normalizeNumber(commit.snapshot.scoreRaw),
      normalizeNumber(commit.snapshot.scoreMin),
      normalizeNumber(commit.snapshot.scoreMax),
      commit.snapshot.totalTimeSeconds,
    ],
    commit.launchSessionId,
    commit.sessionElapsedSeconds,
    commit.sessionTimeDeltaSeconds,
    commit.clientObservedAt,
  ]);
}
