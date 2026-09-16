import { describe, expect, it } from "vitest";
import {
  canonicalizeOfflineScormCommit,
  offlineScormReconciliationBatchSchema,
  offlineScormSignedCommitSchema,
  type OfflineScormSignedCommit,
} from "#/features/scorm/offline-scorm-reconciliation";

function commit(
  overrides: Partial<OfflineScormSignedCommit> = {},
): OfflineScormSignedCommit {
  return {
    schemaVersion: 1,
    entitlementId: "entitlement_1",
    attemptId: "attempt_1",
    commitId: "commit_0000000001",
    clientSequence: 1,
    historyBaseRevision: 3,
    runtimeVersion: "offline-scorm-1",
    offering: {
      kind: "course",
      enrollmentId: "enrollment_1",
      courseVersionItemId: "course_item_1",
    },
    packageVersionId: "package_version_1",
    packageSha256: "a".repeat(64),
    reason: "commit",
    snapshot: {
      lessonStatus: "incomplete",
      location: "slide-2",
      suspendData: "bounded-state",
      scoreRaw: 50,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: 45,
    },
    launchSessionId: "launch_0000000001",
    sessionElapsedSeconds: 45,
    sessionTimeDeltaSeconds: 15,
    clientObservedAt: "2026-09-16T01:02:03.000Z",
    signature: "A".repeat(86),
    ...overrides,
  };
}

describe("offline SCORM reconciliation contract", () => {
  it("uses one fixed-position canonical encoding and excludes the signature", () => {
    const record = commit();
    expect(canonicalizeOfflineScormCommit(record)).toBe(
      JSON.stringify([
        "upskill-offline-scorm-commit-v1",
        1,
        "entitlement_1",
        "attempt_1",
        "commit_0000000001",
        1,
        3,
        "offline-scorm-1",
        ["course", "enrollment_1", "course_item_1"],
        "package_version_1",
        "a".repeat(64),
        "commit",
        ["incomplete", "slide-2", "bounded-state", 50, 0, 100, 45],
        "launch_0000000001",
        45,
        15,
        "2026-09-16T01:02:03.000Z",
      ]),
    );
    expect(
      canonicalizeOfflineScormCommit({
        ...record,
        signature: "B".repeat(86),
      }),
    ).toBe(canonicalizeOfflineScormCommit(record));
  });

  it("normalizes UTC instants and signed zero values", () => {
    const parsed = offlineScormSignedCommitSchema.parse(
      commit({
        clientObservedAt: "2026-09-16T01:02:03Z",
        snapshot: {
          ...commit().snapshot,
          scoreRaw: -0,
        },
      }),
    );
    expect(parsed.clientObservedAt).toBe("2026-09-16T01:02:03.000Z");
    expect(canonicalizeOfflineScormCommit(parsed)).toContain(
      '["incomplete","slide-2","bounded-state",0,0,100,45]',
    );
  });

  it("rejects unsigned extensions and inconsistent session deltas", () => {
    expect(() =>
      offlineScormSignedCommitSchema.parse({
        ...commit(),
        ignoredSemanticField: "must not be stripped before verification",
      }),
    ).toThrow();
    expect(() =>
      offlineScormSignedCommitSchema.parse({
        ...commit(),
        snapshot: {
          ...commit().snapshot,
          ignoredSnapshotField: "must also be signed or rejected",
        },
      }),
    ).toThrow();
    expect(() =>
      offlineScormSignedCommitSchema.parse(
        commit({ sessionElapsedSeconds: 5, sessionTimeDeltaSeconds: 6 }),
      ),
    ).toThrow();
  });

  it("requires one exact entitlement and unique journal identities per batch", () => {
    const first = commit();
    expect(() =>
      offlineScormReconciliationBatchSchema.parse({
        schemaVersion: 1,
        entitlementId: first.entitlementId,
        attemptId: first.attemptId,
        commits: [
          first,
          {
            ...first,
            attemptId: "another_attempt",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      offlineScormReconciliationBatchSchema.parse({
        schemaVersion: 1,
        entitlementId: first.entitlementId,
        attemptId: first.attemptId,
        commits: [first, first],
      }),
    ).toThrow();
  });
});
