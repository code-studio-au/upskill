import { createPublicKey, verify } from "node:crypto";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOfflineScormIndexedDbSchema,
  OfflineScormIndexedDbStore,
} from "#/features/scorm/offline-scorm-indexeddb";
import {
  createOfflineScormDeviceKeyRecord,
  fingerprintOfflineScormSpoolEntry,
  OFFLINE_SCORM_TRUSTED_DATABASE_VERSION,
  OfflineScormRuntimeError,
  OfflineScormTrustedRuntime,
  offlineScormLocalStatusLabels,
  offlineScormTrustedStoreNames,
  resolveOfflineScormLocalStatus,
  type OfflineScormSpoolEntry,
  type OfflineScormTrustedEntitlement,
} from "#/features/scorm/offline-scorm-trusted-runtime";
import { canonicalizeOfflineScormCommit } from "#/features/scorm/offline-scorm-reconciliation";

const stores: { databaseName: string; store: OfflineScormIndexedDbStore }[] =
  [];
const baseInstant = "2026-09-16T01:02:03.000Z";

function createStore(
  databaseName = `offline-scorm-test-${crypto.randomUUID()}`,
): OfflineScormIndexedDbStore {
  const store = new OfflineScormIndexedDbStore({
    databaseName,
    factory: indexedDB,
    keyRange: IDBKeyRange,
  });
  stores.push({ databaseName, store });
  return store;
}

async function deleteDatabase(databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.addEventListener(
      "success",
      () => {
        resolve();
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("Test database deletion failed"));
      },
      { once: true },
    );
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("Test IndexedDB request failed"));
      },
      { once: true },
    );
  });
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      "complete",
      () => {
        resolve();
      },
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => {
        reject(transaction.error ?? new Error("Test transaction failed"));
      },
      { once: true },
    );
  });
}

afterEach(async () => {
  const usedStores = stores.splice(0);
  for (const { store } of usedStores) await store.close();
  for (const databaseName of new Set(
    usedStores.map((entry) => entry.databaseName),
  ))
    await deleteDatabase(databaseName);
});

function entitlement(
  overrides: Partial<OfflineScormTrustedEntitlement> = {},
): OfflineScormTrustedEntitlement {
  return {
    schemaVersion: 1,
    entitlementId: "entitlement_1",
    attemptId: "attempt_1",
    installationId: "installation_1",
    learnerId: "learner_1",
    devicePublicKeySha256: "b".repeat(64),
    historyBaseRevision: 3,
    runtimeVersion: "offline-scorm-1",
    offering: {
      kind: "course",
      enrollmentId: "enrollment_1",
      courseVersionItemId: "course_item_1",
    },
    packageVersionId: "package_version_1",
    packageSha256: "a".repeat(64),
    initialSnapshot: {
      lessonStatus: "incomplete",
      location: "",
      suspendData: "",
      scoreRaw: null,
      scoreMin: null,
      scoreMax: null,
      totalTimeSeconds: 0,
    },
    issuedAt: "2026-09-16T00:00:00.000Z",
    intendedLaunchExpiresAt: "2026-10-16T00:00:00.000Z",
    commitAcceptanceDeadline: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

function spoolEntry(
  overrides: Partial<OfflineScormSpoolEntry> = {},
): OfflineScormSpoolEntry {
  return {
    schemaVersion: 1,
    spoolEntryId: "spool_entry_000001",
    ordinal: 1,
    reason: "commit",
    snapshot: {
      lessonStatus: "incomplete",
      location: "slide-2",
      suspendData: "bounded-state",
      scoreRaw: 50,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: 20,
    },
    launchSessionId: "launch_session_000001",
    sessionElapsedSeconds: 20,
    sessionTimeDeltaSeconds: 20,
    clientObservedAt: baseInstant,
    ...overrides,
  };
}

async function prepareStore(store: OfflineScormIndexedDbStore) {
  const deviceKey = await createOfflineScormDeviceKeyRecord("installation_1", {
    learnerId: "learner_1",
    now: () => new Date("2026-09-16T00:00:00.000Z"),
  });
  await store.putInstallation(deviceKey);
  await store.putEntitlement(
    entitlement({ devicePublicKeySha256: deviceKey.publicKeySha256 }),
  );
  return deviceKey;
}

describe("offline SCORM trusted IndexedDB", () => {
  it("opens the complete versioned schema and persists a non-exportable key", async () => {
    const store = createStore();
    const database = await store.open();
    expect(database.version).toBe(OFFLINE_SCORM_TRUSTED_DATABASE_VERSION);
    expect(Array.from(database.objectStoreNames)).toEqual(
      [...offlineScormTrustedStoreNames].sort(),
    );
    expect(() => {
      assertOfflineScormIndexedDbSchema(database);
    }).not.toThrow();

    const key = await createOfflineScormDeviceKeyRecord("installation_1", {
      learnerId: "learner_1",
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });
    expect(key.privateKey.extractable).toBe(false);
    expect(key.publicKeySha256).toMatch(/^[a-f0-9]{64}$/u);
    await store.putInstallation(key);
    const recovered = await store.getInstallation("installation_1");
    expect(recovered?.privateKey.extractable).toBe(false);
    expect(recovered?.publicKeySpki).toEqual(key.publicKeySpki);

    const anotherLearnerKey = await createOfflineScormDeviceKeyRecord(
      "installation_2",
      {
        learnerId: "learner_2",
        now: () => new Date("2026-09-16T00:00:00.000Z"),
      },
    );
    await expect(
      store.putInstallation(anotherLearnerKey),
    ).rejects.toMatchObject({ code: "device_key_unavailable" });
    await expect(store.putEntitlement(entitlement())).rejects.toMatchObject({
      code: "device_key_unavailable",
    });
  });

  it("reserves, signs and finalises exactly one stable journal record", async () => {
    const store = createStore();
    const key = await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const entry = spoolEntry();

    const first = await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry,
    });
    const duplicate = await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry,
    });
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ clientSequence: 1, status: "protected" });

    const database = await store.open();
    const transaction = database.transaction("journal", "readonly");
    const record = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = transaction
          .objectStore("journal")
          .get(["attempt_1", entry.spoolEntryId]);
        request.addEventListener(
          "success",
          () => {
            resolve(request.result as Record<string, unknown>);
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () => {
            reject(request.error ?? new Error("Journal read failed"));
          },
          { once: true },
        );
      },
    );
    expect(record.status).toBe("pending");
    expect(record.signature).toMatch(/^[A-Za-z0-9_-]{86}$/u);
    const unsignedCommit = record.unsignedCommit as Parameters<
      typeof canonicalizeOfflineScormCommit
    >[0];
    expect(
      verify(
        "sha256",
        canonicalizeOfflineScormCommit(unsignedCommit),
        {
          key: createPublicKey({
            key: key.publicKeySpki,
            format: "der",
            type: "spki",
          }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(String(record.signature), "base64url"),
      ),
    ).toBe(true);
  });

  it("recovers a crash after reservation without reallocating sequence", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    const reservation = await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_crash_reservation_0001",
      reservedAt: baseInstant,
    });
    expect(reservation.status).toBe("signing");

    await expect(
      store.reserveSpoolEntry({
        attemptId: "attempt_1",
        entry: spoolEntry({
          spoolEntryId: "spool_entry_000002",
          ordinal: 2,
          sessionElapsedSeconds: 25,
          sessionTimeDeltaSeconds: 5,
        }),
        fingerprint: "b".repeat(64),
        candidateCommitId: "commit_blocked_reservation_1",
        reservedAt: baseInstant,
      }),
    ).rejects.toMatchObject({ code: "signing_in_progress" });

    const databaseName = stores.at(-1)?.databaseName;
    expect(databaseName).toBeDefined();
    await store.close();
    const restartedStore = createStore(databaseName);
    const recovered = await new OfflineScormTrustedRuntime(restartedStore, {
      now: () => new Date(baseInstant),
    }).recoverSigningReservations("attempt_1");
    expect(recovered).toEqual({
      acknowledgements: [
        expect.objectContaining({
          commitId: reservation.commitId,
          clientSequence: 1,
          status: "protected",
        }),
      ],
      failures: [],
    });
    expect(await restartedStore.listSigningReservations("attempt_1")).toEqual({
      reservations: [],
      corruptAttemptIds: [],
    });
  });

  it("isolates recovery from another attempt's corrupt reservation", async () => {
    const store = createStore();
    const key = await prepareStore(store);
    await store.putEntitlement(
      entitlement({
        entitlementId: "entitlement_2",
        attemptId: "attempt_2",
        devicePublicKeySha256: key.publicKeySha256,
        offering: {
          kind: "course",
          enrollmentId: "enrollment_2",
          courseVersionItemId: "course_item_2",
        },
      }),
    );
    const firstEntry = spoolEntry();
    const secondEntry = spoolEntry({ spoolEntryId: "spool_entry_000002" });
    const firstFingerprint =
      await fingerprintOfflineScormSpoolEntry(firstEntry);
    const secondFingerprint =
      await fingerprintOfflineScormSpoolEntry(secondEntry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
      fingerprint: firstFingerprint.fingerprint,
      candidateCommitId: "commit_attempt_one_000001",
      reservedAt: baseInstant,
    });
    await store.reserveSpoolEntry({
      attemptId: "attempt_2",
      entry: secondEntry,
      fingerprint: secondFingerprint.fingerprint,
      candidateCommitId: "commit_attempt_two_000001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const corruptRecord = (await idbRequest(
      journal.get(["attempt_2", secondEntry.spoolEntryId]),
    )) as Record<string, unknown>;
    journal.put({
      ...corruptRecord,
      unsignedCommit: {
        ...(corruptRecord.unsignedCommit as Record<string, unknown>),
        commitId: "commit_mismatched_000001",
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const scopedRecovery =
      await runtime.recoverSigningReservations("attempt_1");
    expect(scopedRecovery).toEqual({
      acknowledgements: [
        expect.objectContaining({ attemptId: "attempt_1", clientSequence: 1 }),
      ],
      failures: [],
    });
    expect(await store.listSigningReservations("attempt_2")).toEqual({
      reservations: [],
      corruptAttemptIds: ["attempt_2"],
    });
    expect(await runtime.recoverSigningReservations()).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_2", code: "journal_corrupt" }],
    });
  });

  it("fails closed for identifier reuse, sequence gaps and completion regression", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const entry = spoolEntry({
      snapshot: {
        ...spoolEntry().snapshot,
        lessonStatus: "completed",
      },
    });
    await runtime.importSpoolEntry({ attemptId: "attempt_1", entry });

    await expect(
      runtime.importSpoolEntry({
        attemptId: "attempt_1",
        entry: {
          ...entry,
          snapshot: { ...entry.snapshot, location: "tampered" },
        },
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await expect(
      runtime.importSpoolEntry({
        attemptId: "attempt_1",
        entry: spoolEntry({
          spoolEntryId: "spool_entry_000003",
          ordinal: 3,
          sessionElapsedSeconds: 30,
          sessionTimeDeltaSeconds: 10,
        }),
      }),
    ).rejects.toMatchObject({ code: "launch_history_invalid" });
    await expect(
      runtime.importSpoolEntry({
        attemptId: "attempt_1",
        entry: spoolEntry({
          spoolEntryId: "spool_entry_000002",
          ordinal: 2,
          sessionElapsedSeconds: 30,
          sessionTimeDeltaSeconds: 10,
          snapshot: {
            ...spoolEntry().snapshot,
            lessonStatus: "incomplete",
            totalTimeSeconds: 30,
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "launch_history_invalid" });
  });

  it("retains a failed signing reservation and reports the attempt error", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_failed_recovery_0001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction(
      "installations",
      "readwrite",
    );
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const installationStore =
      corruptionTransaction.objectStore("installations");
    const installation = (await idbRequest(
      installationStore.get("installation_1"),
    )) as Record<string, unknown>;
    installationStore.put({
      ...installation,
      publicKeySha256: "c".repeat(64),
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const recovered = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).recoverSigningReservations("attempt_1");
    expect(recovered).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "device_key_unavailable" }],
    });
    expect(
      (await store.listSigningReservations("attempt_1")).reservations,
    ).toHaveLength(1);

    const readTransaction = database.transaction("attempts", "readonly");
    const attempt = (await idbRequest(
      readTransaction.objectStore("attempts").get("attempt_1"),
    )) as Record<string, unknown>;
    expect(attempt.lastErrorCode).toBe("device_key_unavailable");
  });
});

describe("offline SCORM local status vocabulary", () => {
  it("prioritises attention, staging and authoritative completion honestly", () => {
    expect(Object.values(offlineScormLocalStatusLabels)).toEqual([
      "Ready offline",
      "Saving locally",
      "Progress protected on this device",
      "Completed on this device",
      "Completed and synced",
      "Needs attention",
    ]);
    expect(
      resolveOfflineScormLocalStatus({
        needsAttention: true,
        stagedSpoolCount: 1,
        pendingJournalCount: 1,
        locallyCompleted: true,
        serverCompletionConfirmed: true,
      }),
    ).toBe("needs_attention");
    expect(
      resolveOfflineScormLocalStatus({
        needsAttention: false,
        stagedSpoolCount: 1,
        pendingJournalCount: 0,
        locallyCompleted: false,
        serverCompletionConfirmed: false,
      }),
    ).toBe("saving_locally");
    expect(
      resolveOfflineScormLocalStatus({
        needsAttention: false,
        stagedSpoolCount: 0,
        pendingJournalCount: 0,
        locallyCompleted: true,
        serverCompletionConfirmed: true,
      }),
    ).toBe("completed_and_synced");
  });

  it("keeps typed runtime errors available to callers", () => {
    expect(
      new OfflineScormRuntimeError("storage_failed", "failed"),
    ).toMatchObject({
      name: "OfflineScormRuntimeError",
      code: "storage_failed",
    });
  });
});
