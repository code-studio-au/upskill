import { createHash, createPublicKey, verify } from "node:crypto";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOfflineScormIndexedDbSchema,
  OfflineScormIndexedDbStore,
} from "#/features/scorm/offline-scorm-indexeddb";
import {
  createOfflineScormDeviceKeyRecord,
  fingerprintOfflineScormCommit,
  fingerprintOfflineScormSpoolEntry,
  OFFLINE_SCORM_TRUSTED_DATABASE_VERSION,
  OfflineScormRuntimeError,
  OfflineScormTrustedRuntime,
  offlineScormLocalStatusLabels,
  offlineScormTrustedStoreNames,
  resolveOfflineScormLocalStatus,
  type OfflineScormJournalRecord,
  type OfflineScormPackageRecord,
  type OfflineScormReceipt,
  type OfflineScormSpoolEntry,
  type OfflineScormTrustedEntitlement,
  type OfflineScormTrustedStore,
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

function receipt(
  overrides: Partial<OfflineScormReceipt> = {},
): OfflineScormReceipt {
  return {
    schemaVersion: 1,
    entitlementId: "entitlement_1",
    attemptId: "attempt_1",
    commitId: "commit_placeholder_0001",
    clientSequence: 1,
    requestFingerprint: "d".repeat(64),
    outcome: "accepted",
    reasonCode: "accepted",
    resultingAttemptRevision: 4,
    receivedAt: baseInstant,
    ...overrides,
  };
}

function packageRecord(
  overrides: Partial<OfflineScormPackageRecord> = {},
): OfflineScormPackageRecord {
  return {
    schemaVersion: 1,
    attemptId: "attempt_1",
    entitlementId: "entitlement_1",
    packageVersionId: "package_version_1",
    packageSha256: "a".repeat(64),
    packageOrigin: "https://offline-attempt.example",
    drainUrl: "https://offline-attempt.example/drain",
    status: "downloading",
    updatedAt: baseInstant,
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
    expect(
      Array.from(
        database.transaction("journal", "readonly").objectStore("journal")
          .indexNames,
      ),
    ).toContain("byAttemptId");

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

  it("enumerates the retained installation and package registry", async () => {
    const store = createStore();
    const key = await prepareStore(store);
    await store.putPackage(packageRecord());

    await expect(
      store.findInstallationForLearner("learner_1"),
    ).resolves.toEqual(key);
    await expect(store.findInstallationForLearner("learner_2")).resolves.toBe(
      undefined,
    );
    await expect(store.getPackage("attempt_1")).resolves.toEqual(
      packageRecord(),
    );
    await expect(store.listPackages()).resolves.toEqual([packageRecord()]);
  });

  it("lists verified pending commits and clears only acknowledged attempts", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const imported = await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry(),
    });
    const [commit] = await store.listPendingSignedCommits("attempt_1");
    expect(commit).toMatchObject({
      attemptId: "attempt_1",
      commitId: imported.commitId,
      clientSequence: 1,
    });
    await expect(
      store.listPendingSignedCommits("attempt_1", 0),
    ).rejects.toThrow("batch limit");
    await store.putPackage(packageRecord());
    await store.putPackage(
      packageRecord({
        status: "ready",
        updatedAt: "2026-09-16T01:03:00.000Z",
      }),
    );
    await expect(
      store.clearAcknowledgedAttempt("attempt_1"),
    ).rejects.toMatchObject({ code: "signing_in_progress" });
    if (!commit) throw new Error("Expected a signed commit");
    await store.putReceipt(
      receipt({
        commitId: commit.commitId,
        requestFingerprint: await fingerprintOfflineScormCommit(commit),
      }),
    );
    await store.putPackage(
      packageRecord({
        status: "cleanup_pending",
        updatedAt: "2026-09-16T01:04:00.000Z",
      }),
    );
    await store.putPackage(
      packageRecord({
        status: "cleared",
        updatedAt: "2026-09-16T01:05:00.000Z",
      }),
    );
    await store.clearAcknowledgedAttempt("attempt_1");

    await expect(store.listPackages()).resolves.toEqual([]);
    await expect(
      store.getAttemptJournalSnapshot("attempt_1"),
    ).rejects.toMatchObject({ code: "attempt_unavailable" });
    await expect(
      store.getInstallation("installation_1"),
    ).resolves.toBeUndefined();
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

  it("clears a retained attempt error after a fully verified exact retry", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const first = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).importSpoolEntry({ attemptId: "attempt_1", entry });
    await store.markAttemptError({
      attemptId: "attempt_1",
      errorCode: "storage_failed",
      updatedAt: "2026-09-16T01:03:00.000Z",
    });
    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).attempt
        .lastErrorCode,
    ).toBe("storage_failed");

    const retry = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date("2026-09-16T01:04:00.000Z"),
    }).importSpoolEntry({ attemptId: "attempt_1", entry });

    expect(retry).toEqual(first);
    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).attempt
        .lastErrorCode,
    ).toBeNull();
  });

  it("rejects stale and regressing package lifecycle updates atomically", async () => {
    const store = createStore();
    await prepareStore(store);
    const downloading = packageRecord();
    const ready = packageRecord({
      status: "ready",
      updatedAt: "2026-09-16T01:03:00.000Z",
    });
    const cleanupPending = packageRecord({
      status: "cleanup_pending",
      updatedAt: "2026-09-16T01:04:00.000Z",
    });
    const cleared = packageRecord({
      status: "cleared",
      cleanupReceiptSha256: "e".repeat(64),
      updatedAt: "2026-09-16T01:07:00.000Z",
    });

    await store.putPackage(downloading);
    await store.putPackage(downloading);
    await store.putPackage(ready);
    await store.putPackage(cleanupPending);
    await expect(
      store.putPackage(
        packageRecord({
          status: "ready",
          updatedAt: "2026-09-16T01:03:30.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await expect(
      store.putPackage(
        packageRecord({
          status: "ready",
          updatedAt: "2026-09-16T01:05:00.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await store.putPackage(cleared);
    await expect(
      store.putPackage(
        packageRecord({
          status: "cleanup_pending",
          updatedAt: "2026-09-16T01:08:00.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await store.putPackage(cleared);
    await expect(
      store.putPackage({
        ...cleared,
        cleanupReceiptSha256: "f".repeat(64),
        updatedAt: "2026-09-16T01:08:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await expect(
      store.putPackage({
        ...cleared,
        cleanupReceiptSha256: undefined,
        updatedAt: "2026-09-16T01:08:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const database = await store.open();
    const transaction = database.transaction("packages", "readonly");
    const completed = idbTransaction(transaction);
    expect(
      await idbRequest(transaction.objectStore("packages").get("attempt_1")),
    ).toEqual(cleared);
    await completed;
  });

  it("leases an active package origin to one attempt until cleanup is complete", async () => {
    const store = createStore();
    const key = await prepareStore(store);
    await store.putEntitlement(
      entitlement({
        entitlementId: "entitlement_2",
        attemptId: "attempt_2",
        devicePublicKeySha256: key.publicKeySha256,
        packageVersionId: "package_version_2",
        packageSha256: "c".repeat(64),
        offering: {
          kind: "course",
          enrollmentId: "enrollment_2",
          courseVersionItemId: "course_item_2",
        },
      }),
    );
    const firstPackage = packageRecord();
    const secondPackage = packageRecord({
      attemptId: "attempt_2",
      entitlementId: "entitlement_2",
      packageVersionId: "package_version_2",
      packageSha256: "c".repeat(64),
      updatedAt: "2026-09-16T01:05:00.000Z",
    });
    const siblingOriginPackage = packageRecord({
      ...secondPackage,
      packageOrigin: "https://sibling.offline-attempt.example",
      drainUrl: "https://sibling.offline-attempt.example/drain",
    });

    await store.putPackage(firstPackage);
    await expect(store.putPackage(secondPackage)).rejects.toMatchObject({
      code: "journal_corrupt",
    });
    await expect(store.putPackage(siblingOriginPackage)).rejects.toMatchObject({
      code: "journal_corrupt",
    });
    await store.putPackage(
      packageRecord({
        status: "cleanup_pending",
        updatedAt: "2026-09-16T01:03:00.000Z",
      }),
    );
    await expect(store.putPackage(secondPackage)).rejects.toMatchObject({
      code: "journal_corrupt",
    });
    const clearedPackage = packageRecord({
      status: "cleared",
      updatedAt: "2026-09-16T01:04:00.000Z",
    });
    await store.putPackage(clearedPackage);
    await store.putPackage(secondPackage);

    const database = await store.open();
    const transaction = database.transaction("packages", "readonly");
    const completed = idbTransaction(transaction);
    expect(
      await idbRequest(transaction.objectStore("packages").getAll()),
    ).toEqual([clearedPackage, secondPackage]);
    await completed;
  });

  it("atomically acknowledges an exact reconciliation receipt and repairs its retry", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry(),
    });
    const [record] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected a finalised journal record");
    const requestFingerprint = await fingerprintOfflineScormCommit(
      record.unsignedCommit,
    );
    expect(requestFingerprint).toBe(
      createHash("sha256")
        .update(canonicalizeOfflineScormCommit(record.unsignedCommit), "utf8")
        .digest("hex"),
    );
    const validReceipt = receipt({
      commitId: record.commitId,
      clientSequence: record.clientSequence,
      requestFingerprint,
    });

    await store.putReceipt(validReceipt);

    const database = await store.open();
    const firstInspection = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const firstInspectionComplete = idbTransaction(firstInspection);
    expect(
      await idbRequest(
        firstInspection
          .objectStore("journal")
          .get(["attempt_1", record.spoolEntryId]),
      ),
    ).toMatchObject({ status: "acknowledged" });
    expect(
      await idbRequest(firstInspection.objectStore("receipts").getAll()),
    ).toEqual([validReceipt]);
    await firstInspectionComplete;

    const legacyTransaction = database.transaction("journal", "readwrite");
    const legacyComplete = idbTransaction(legacyTransaction);
    legacyTransaction.objectStore("journal").put({
      ...record,
      status: "pending",
    });
    legacyTransaction.commit();
    await legacyComplete;

    await store.putReceipt(validReceipt);

    const retryInspection = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const retryInspectionComplete = idbTransaction(retryInspection);
    expect(
      await idbRequest(
        retryInspection
          .objectStore("journal")
          .get(["attempt_1", record.spoolEntryId]),
      ),
    ).toMatchObject({ status: "acknowledged" });
    expect(
      await idbRequest(retryInspection.objectStore("receipts").getAll()),
    ).toEqual([validReceipt]);
    await retryInspectionComplete;
  });

  it("rejects noncontiguous and regressing accepted receipt revisions", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry();
    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: { ...firstEntry.snapshot, totalTimeSeconds: 30 },
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: secondEntry,
    });
    const [firstRecord, secondRecord] = (
      await store.getAttemptJournalSnapshot("attempt_1")
    ).records;
    expect(firstRecord).toBeDefined();
    expect(secondRecord).toBeDefined();
    if (!firstRecord || !secondRecord)
      throw new Error("Expected two finalised journal records");
    const firstReceipt = receipt({
      commitId: firstRecord.commitId,
      clientSequence: firstRecord.clientSequence,
      requestFingerprint: await fingerprintOfflineScormCommit(
        firstRecord.unsignedCommit,
      ),
      resultingAttemptRevision: 4,
    });
    const regressingSecondReceipt = receipt({
      commitId: secondRecord.commitId,
      clientSequence: secondRecord.clientSequence,
      requestFingerprint: await fingerprintOfflineScormCommit(
        secondRecord.unsignedCommit,
      ),
      resultingAttemptRevision: 3,
      receivedAt: "2026-09-16T01:03:00.000Z",
    });

    await expect(
      store.putReceipt(regressingSecondReceipt),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await store.putReceipt(firstReceipt);
    await expect(
      store.putReceipt(regressingSecondReceipt),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const database = await store.open();
    const transaction = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const completed = idbTransaction(transaction);
    expect(
      await idbRequest(transaction.objectStore("receipts").getAll()),
    ).toEqual([firstReceipt]);
    expect(
      await idbRequest(
        transaction
          .objectStore("journal")
          .get(["attempt_1", secondEntry.spoolEntryId]),
      ),
    ).toMatchObject({ status: "pending" });
    await completed;
  });

  it.each([
    {
      outcome: "rejected" as const,
      reasonCode: "acceptance_deadline_elapsed",
    },
    { outcome: "conflict" as const, reasonCode: "history_conflict" },
  ])("acknowledges a terminal $outcome receipt", async (terminalOutcome) => {
    const store = createStore();
    await prepareStore(store);
    await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).importSpoolEntry({ attemptId: "attempt_1", entry: spoolEntry() });
    const [record] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected a finalised journal record");
    await store.putReceipt(
      receipt({
        commitId: record.commitId,
        clientSequence: record.clientSequence,
        requestFingerprint: await fingerprintOfflineScormCommit(
          record.unsignedCommit,
        ),
        outcome: terminalOutcome.outcome,
        reasonCode: terminalOutcome.reasonCode,
        resultingAttemptRevision: null,
      }),
    );

    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).records[0],
    ).toMatchObject({ status: "acknowledged" });
  });

  it("explicitly discards an unreachable journal tail after a terminal receipt", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry(),
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry({
        spoolEntryId: "spool_entry_000002",
        ordinal: 2,
        sessionElapsedSeconds: 40,
        sessionTimeDeltaSeconds: 20,
        clientObservedAt: "2026-09-16T01:02:04.000Z",
        snapshot: {
          ...spoolEntry().snapshot,
          location: "slide-3",
          totalTimeSeconds: 40,
        },
      }),
    });
    const [first, second] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    if (!first || !second) throw new Error("Expected two journal records");
    const terminalReceipt = receipt({
      commitId: first.commitId,
      clientSequence: first.clientSequence,
      requestFingerprint: await fingerprintOfflineScormCommit(
        first.unsignedCommit,
      ),
      outcome: "conflict",
      reasonCode: "history_conflict",
      resultingAttemptRevision: null,
    });
    await store.putReceipt(terminalReceipt);

    await expect(store.getTerminalReceipt("attempt_1")).resolves.toEqual(
      terminalReceipt,
    );
    await expect(store.listPendingSignedCommits("attempt_1")).resolves.toEqual([
      expect.objectContaining({ commitId: second.commitId }),
    ]);

    await store.discardJournalAfterTerminalReceipt("attempt_1");
    await expect(store.listPendingSignedCommits("attempt_1")).resolves.toEqual(
      [],
    );
    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).records.map(
        (record) => record.status,
      ),
    ).toEqual(["discarded", "discarded"]);
    await expect(
      store.putReceipt(
        receipt({
          commitId: second.commitId,
          clientSequence: second.clientSequence,
          requestFingerprint: await fingerprintOfflineScormCommit(
            second.unsignedCommit,
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    await store.putPackage(packageRecord());
    await store.putPackage(
      packageRecord({
        status: "ready",
        updatedAt: "2026-09-16T01:03:00.000Z",
      }),
    );
    await store.putPackage(
      packageRecord({
        status: "cleanup_pending",
        updatedAt: "2026-09-16T01:04:00.000Z",
      }),
    );
    await store.putPackage(
      packageRecord({
        status: "cleared",
        updatedAt: "2026-09-16T01:05:00.000Z",
      }),
    );
    await expect(
      store.clearAcknowledgedAttempt("attempt_1"),
    ).resolves.toBeUndefined();
  });

  it("rejects receipts that do not match immutable journal evidence", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry(),
    });
    const [record] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected a finalised journal record");
    const validReceipt = receipt({
      commitId: record.commitId,
      clientSequence: record.clientSequence,
      requestFingerprint: await fingerprintOfflineScormCommit(
        record.unsignedCommit,
      ),
    });
    const mismatches: OfflineScormReceipt[] = [
      { ...validReceipt, entitlementId: "entitlement_other" },
      { ...validReceipt, attemptId: "attempt_other" },
      { ...validReceipt, commitId: "commit_unknown_000001" },
      { ...validReceipt, clientSequence: 2 },
      { ...validReceipt, requestFingerprint: "e".repeat(64) },
      { ...validReceipt, resultingAttemptRevision: 5 },
    ];
    for (const mismatch of mismatches)
      await expect(store.putReceipt(mismatch)).rejects.toMatchObject({
        code: "journal_corrupt",
      });
    await expect(
      store.putReceipt({ ...validReceipt, resultingAttemptRevision: null }),
    ).rejects.toThrow();
    await expect(
      store.putReceipt({
        ...validReceipt,
        outcome: "rejected",
        reasonCode: "acceptance_deadline_elapsed",
      }),
    ).rejects.toThrow();

    const database = await store.open();
    const transaction = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const completed = idbTransaction(transaction);
    expect(await idbRequest(transaction.objectStore("receipts").count())).toBe(
      0,
    );
    expect(
      await idbRequest(
        transaction
          .objectStore("journal")
          .get(["attempt_1", record.spoolEntryId]),
      ),
    ).toMatchObject({ status: "pending" });
    await completed;
  });

  it("rejects a receipt when the stored signature no longer verifies", async () => {
    const store = createStore();
    await prepareStore(store);
    await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).importSpoolEntry({ attemptId: "attempt_1", entry: spoolEntry() });
    const [record] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected a finalised journal record");

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    corruptionTransaction.objectStore("journal").put({
      ...record,
      signature: "A".repeat(86),
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    await expect(
      store.putReceipt(
        receipt({
          commitId: record.commitId,
          clientSequence: record.clientSequence,
          requestFingerprint: await fingerprintOfflineScormCommit(
            record.unsignedCommit,
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspection = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const inspectionComplete = idbTransaction(inspection);
    expect(await idbRequest(inspection.objectStore("receipts").count())).toBe(
      0,
    );
    expect(
      await idbRequest(
        inspection
          .objectStore("journal")
          .get(["attempt_1", record.spoolEntryId]),
      ),
    ).toMatchObject({ status: "pending" });
    await inspectionComplete;
  });

  it("scopes receipt history validation to the current attempt", async () => {
    const store = createStore();
    await prepareStore(store);
    await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).importSpoolEntry({ attemptId: "attempt_1", entry: spoolEntry() });
    const [record] = (await store.getAttemptJournalSnapshot("attempt_1"))
      .records;
    expect(record).toBeDefined();
    if (!record) throw new Error("Expected a finalised journal record");

    const database = await store.open();
    const corruption = database.transaction("receipts", "readwrite");
    const corruptionComplete = idbTransaction(corruption);
    corruption.objectStore("receipts").add({
      attemptId: "attempt_2",
      commitId: "malformed_receipt_0001",
      clientSequence: 1,
    });
    corruption.commit();
    await corruptionComplete;

    const validReceipt = receipt({
      commitId: record.commitId,
      clientSequence: record.clientSequence,
      requestFingerprint: await fingerprintOfflineScormCommit(
        record.unsignedCommit,
      ),
    });
    await store.putReceipt(validReceipt);

    const inspection = database.transaction(
      ["journal", "receipts"],
      "readonly",
    );
    const inspectionComplete = idbTransaction(inspection);
    expect(await idbRequest(inspection.objectStore("receipts").count())).toBe(
      2,
    );
    expect(
      await idbRequest(
        inspection
          .objectStore("journal")
          .get(["attempt_1", record.spoolEntryId]),
      ),
    ).toMatchObject({ status: "acknowledged" });
    await inspectionComplete;
  });

  it("does not record a stale signing failure after concurrent finalisation", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    const reservation = await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_concurrent_0001",
      reservedAt: baseInstant,
    });

    const recovery = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date("2026-09-16T01:03:00.000Z"),
    }).recoverSigningReservations("attempt_1");
    expect(recovery.failures).toEqual([]);

    await store.markAttemptError({
      attemptId: "attempt_1",
      errorCode: "signing_failed",
      updatedAt: "2026-09-16T01:04:00.000Z",
      expectedSigningReservation: reservation,
    });

    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).attempt
        .lastErrorCode,
    ).toBeNull();
  });

  it("does not record a blocked import after its concurrent reservation finalises", async () => {
    const store = createStore();
    await prepareStore(store);
    let enterFinalisation!: () => void;
    let allowFinalisation!: () => void;
    let enterErrorWrite!: () => void;
    let allowErrorWrite!: () => void;
    const finalisationEntered = new Promise<void>((resolve) => {
      enterFinalisation = resolve;
    });
    const finalisationAllowed = new Promise<void>((resolve) => {
      allowFinalisation = resolve;
    });
    const errorWriteEntered = new Promise<void>((resolve) => {
      enterErrorWrite = resolve;
    });
    const errorWriteAllowed = new Promise<void>((resolve) => {
      allowErrorWrite = resolve;
    });
    const racingStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "finaliseJournalEntry")
          return async (
            input: Parameters<
              OfflineScormTrustedStore["finaliseJournalEntry"]
            >[0],
          ) => {
            enterFinalisation();
            await finalisationAllowed;
            return target.finaliseJournalEntry(input);
          };
        if (property === "markAttemptError")
          return async (
            input: Parameters<OfflineScormTrustedStore["markAttemptError"]>[0],
          ) => {
            enterErrorWrite();
            await errorWriteAllowed;
            return target.markAttemptError(input);
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function"
          ? (value as (...arguments_: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as OfflineScormTrustedStore;
    const runtime = new OfflineScormTrustedRuntime(racingStore, {
      now: () => new Date(baseInstant),
    });
    const firstImport = runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry(),
    });
    await finalisationEntered;
    const secondImport = runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: spoolEntry({
        spoolEntryId: "spool_entry_000002",
        ordinal: 2,
        sessionElapsedSeconds: 30,
        sessionTimeDeltaSeconds: 10,
        snapshot: {
          ...spoolEntry().snapshot,
          totalTimeSeconds: 30,
        },
      }),
    });
    await errorWriteEntered;
    allowFinalisation();
    await firstImport;
    allowErrorWrite();

    await expect(secondImport).rejects.toMatchObject({
      code: "signing_in_progress",
    });
    expect(
      (await store.getAttemptJournalSnapshot("attempt_1")).attempt
        .lastErrorCode,
    ).toBeNull();
  });

  it("rejects a retry when stored canonical commit fields were altered", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const entry = spoolEntry();
    await runtime.importSpoolEntry({ attemptId: "attempt_1", entry });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const record = (await idbRequest(
      journal.get(["attempt_1", entry.spoolEntryId]),
    )) as Record<string, unknown>;
    const unsignedCommit = record.unsignedCommit as Record<string, unknown>;
    journal.put({
      ...record,
      unsignedCommit: {
        ...unsignedCommit,
        snapshot: {
          ...(unsignedCommit.snapshot as Record<string, unknown>),
          location: "altered-after-signing",
        },
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
  });

  it("rejects a retry when the stored signature no longer verifies", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const entry = spoolEntry();
    await runtime.importSpoolEntry({ attemptId: "attempt_1", entry });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const record = (await idbRequest(
      journal.get(["attempt_1", entry.spoolEntryId]),
    )) as Record<string, unknown>;
    journal.put({ ...record, signature: "A".repeat(86) });
    corruptionTransaction.commit();
    await corruptionComplete;

    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
  });

  it("blocks a later sequence when finalised history no longer verifies", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry();
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const record = (await idbRequest(
      journal.get(["attempt_1", firstEntry.spoolEntryId]),
    )) as Record<string, unknown>;
    journal.put({ ...record, signature: "A".repeat(86) });
    corruptionTransaction.commit();
    await corruptionComplete;

    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: { ...firstEntry.snapshot, totalTimeSeconds: 30 },
    });
    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry: secondEntry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspectionTransaction = database.transaction("journal", "readonly");
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(inspectionTransaction.objectStore("journal").count()),
    ).toBe(1);
    await inspectionComplete;
  });

  it("blocks a later sequence when the materialised snapshot diverges", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry();
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("attempts", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const attempts = corruptionTransaction.objectStore("attempts");
    const attempt = (await idbRequest(attempts.get("attempt_1"))) as Record<
      string,
      unknown
    >;
    attempts.put({
      ...attempt,
      currentSnapshot: {
        ...(attempt.currentSnapshot as Record<string, unknown>),
        location: "corrupted-projection",
        totalTimeSeconds: 25,
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: {
        ...firstEntry.snapshot,
        location: "corrupted-projection-next",
        totalTimeSeconds: 35,
      },
    });
    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry: secondEntry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspectionTransaction = database.transaction("journal", "readonly");
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(inspectionTransaction.objectStore("journal").count()),
    ).toBe(1);
    await inspectionComplete;
  });

  it.each(["missing", "reset"] as const)(
    "blocks a later sequence when the launch projection is %s",
    async (corruption) => {
      const store = createStore();
      await prepareStore(store);
      const runtime = new OfflineScormTrustedRuntime(store, {
        now: () => new Date(baseInstant),
      });
      const firstEntry = spoolEntry();
      await runtime.importSpoolEntry({
        attemptId: "attempt_1",
        entry: firstEntry,
      });

      const database = await store.open();
      const corruptionTransaction = database.transaction(
        "launches",
        "readwrite",
      );
      const corruptionComplete = idbTransaction(corruptionTransaction);
      const launches = corruptionTransaction.objectStore("launches");
      const launchKey = ["attempt_1", firstEntry.launchSessionId];
      if (corruption === "missing") launches.delete(launchKey);
      else {
        const launch = (await idbRequest(launches.get(launchKey))) as Record<
          string,
          unknown
        >;
        launches.put({
          ...launch,
          nextExpectedOrdinal: 1,
          elapsedHighwaterSeconds: 0,
        });
      }
      corruptionTransaction.commit();
      await corruptionComplete;

      const secondEntry = spoolEntry({
        spoolEntryId: "spool_entry_000002",
        snapshot: { ...firstEntry.snapshot, totalTimeSeconds: 40 },
      });
      const { fingerprint } =
        await fingerprintOfflineScormSpoolEntry(secondEntry);
      await expect(
        store.reserveSpoolEntry({
          attemptId: "attempt_1",
          entry: secondEntry,
          fingerprint,
          candidateCommitId: "commit_corrupt_launch_projection_1",
          reservedAt: baseInstant,
        }),
      ).rejects.toMatchObject({ code: "journal_corrupt" });
      await expect(
        runtime.importSpoolEntry({
          attemptId: "attempt_1",
          entry: secondEntry,
        }),
      ).rejects.toMatchObject({ code: "journal_corrupt" });

      const inspectionTransaction = database.transaction("journal", "readonly");
      const inspectionComplete = idbTransaction(inspectionTransaction);
      expect(
        await idbRequest(inspectionTransaction.objectStore("journal").count()),
      ).toBe(1);
      await inspectionComplete;
    },
  );

  it("reconstructs launch history in client sequence order", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry({
      spoolEntryId: "spool_entry_zzzzzz",
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });

    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_aaaaaa",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: { ...firstEntry.snapshot, totalTimeSeconds: 30 },
    });
    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry: secondEntry }),
    ).resolves.toMatchObject({ clientSequence: 2, status: "protected" });
  });

  it("rejects recovery when a signing commit no longer matches its spool", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_corrupt_recovery_001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const record = (await idbRequest(
      journal.get(["attempt_1", entry.spoolEntryId]),
    )) as Record<string, unknown>;
    const unsignedCommit = record.unsignedCommit as Record<string, unknown>;
    journal.put({
      ...record,
      unsignedCommit: {
        ...unsignedCommit,
        snapshot: {
          ...(unsignedCommit.snapshot as Record<string, unknown>),
          location: "altered-reservation",
        },
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const recovered = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).recoverSigningReservations("attempt_1");
    expect(recovered).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });
  });

  it("rejects recovery when a signing spool no longer matches its fingerprint", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_fingerprint_recovery_1",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const record = (await idbRequest(
      journal.get(["attempt_1", entry.spoolEntryId]),
    )) as Record<string, unknown>;
    const alteredSnapshot = { ...entry.snapshot, location: "altered-together" };
    journal.put({
      ...record,
      spoolEntry: { ...entry, snapshot: alteredSnapshot },
      unsignedCommit: {
        ...(record.unsignedCommit as Record<string, unknown>),
        snapshot: alteredSnapshot,
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const recovered = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).recoverSigningReservations("attempt_1");
    expect(recovered).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });

    const inspectionTransaction = database.transaction("journal", "readonly");
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(
        inspectionTransaction
          .objectStore("journal")
          .get(["attempt_1", entry.spoolEntryId]),
      ),
    ).toMatchObject({ status: "signing", signature: null });
    await inspectionComplete;
  });

  it("rejects recovery when the installation key no longer matches its entitlement", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_replaced_device_key_1",
      reservedAt: baseInstant,
    });

    const replacement = await createOfflineScormDeviceKeyRecord(
      "installation_1",
      {
        learnerId: "learner_1",
        now: () => new Date(baseInstant),
      },
    );
    const database = await store.open();
    const corruptionTransaction = database.transaction(
      "installations",
      "readwrite",
    );
    const corruptionComplete = idbTransaction(corruptionTransaction);
    corruptionTransaction.objectStore("installations").put(replacement);
    corruptionTransaction.commit();
    await corruptionComplete;

    const recovered = await new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    }).recoverSigningReservations("attempt_1");
    expect(recovered).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "device_key_unavailable" }],
      unattributedCorruptRecords: 0,
    });
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
      unattributedCorruptRecords: 0,
    });
    expect(await restartedStore.listSigningReservations("attempt_1")).toEqual({
      reservations: [],
      corruptAttemptIds: [],
      unattributedCorruptRecords: 0,
    });
  });

  it("rejects an empty recovery scope without scanning other attempts", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_empty_scope_0001",
      reservedAt: baseInstant,
    });
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });

    await expect(runtime.recoverSigningReservations("")).rejects.toThrow();
    await expect(store.listSigningReservations("")).rejects.toThrow();
    expect(await store.listSigningReservations("attempt_1")).toMatchObject({
      reservations: [
        expect.objectContaining({
          attemptId: "attempt_1",
          status: "signing",
        }),
      ],
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
      unattributedCorruptRecords: 0,
    });
    expect(await store.listSigningReservations("attempt_2")).toEqual({
      reservations: [],
      corruptAttemptIds: ["attempt_2"],
      unattributedCorruptRecords: 0,
    });
    expect(await runtime.recoverSigningReservations()).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_2", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });
  });

  it("reports unattributed corruption without blocking global recovery", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    const reservation = await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_valid_recovery_0001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    corruptionTransaction.objectStore("journal").add({
      ...reservation,
      attemptId: "invalid attempt id",
      spoolEntryId: "spool_unattributed_0001",
      commitId: "commit_unattributed_0001",
      unsignedCommit: {
        ...reservation.unsignedCommit,
        attemptId: "invalid attempt id",
        commitId: "commit_unattributed_0001",
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    expect(await runtime.recoverSigningReservations()).toEqual({
      acknowledgements: [
        expect.objectContaining({ attemptId: "attempt_1", clientSequence: 1 }),
      ],
      failures: [],
      unattributedCorruptRecords: 1,
    });
    expect(await store.listSigningReservations()).toEqual({
      reservations: [],
      corruptAttemptIds: [],
      unattributedCorruptRecords: 1,
    });
  });

  it("blocks recovery and allocation when indexed journal fields are corrupt", async () => {
    const store = createStore();
    await prepareStore(store);
    const firstEntry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(firstEntry);
    await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
      fingerprint,
      candidateCommitId: "commit_corrupt_index_0001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const corruptRecord = (await idbRequest(
      journal.get(["attempt_1", firstEntry.spoolEntryId]),
    )) as Record<string, unknown>;
    journal.put({
      ...corruptRecord,
      clientSequence: "not-a-sequence",
      status: "not-a-status",
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    expect(await runtime.recoverSigningReservations("attempt_1")).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });
    expect(await runtime.recoverSigningReservations()).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });

    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: {
        ...firstEntry.snapshot,
        totalTimeSeconds: 30,
      },
    });
    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry: secondEntry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspectionTransaction = database.transaction("journal", "readonly");
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(inspectionTransaction.objectStore("journal").count()),
    ).toBe(1);
    await inspectionComplete;
  });

  it("rejects finalisation when the stored reservation changes after signing", async () => {
    const store = createStore();
    await prepareStore(store);
    const entry = spoolEntry();
    const { fingerprint } = await fingerprintOfflineScormSpoolEntry(entry);
    const reservation = await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry,
      fingerprint,
      candidateCommitId: "commit_before_signing_0001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const changedCommitId = "commit_changed_after_sign_1";
    corruptionTransaction.objectStore("journal").put({
      ...reservation,
      commitId: changedCommitId,
      unsignedCommit: {
        ...reservation.unsignedCommit,
        commitId: changedCommitId,
      },
    });
    corruptionTransaction.commit();
    await corruptionComplete;

    await expect(
      store.finaliseJournalEntry({
        reservation,
        signature: "a".repeat(86),
        finalisedAt: "2026-09-16T01:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspectionTransaction = database.transaction(
      ["attempts", "journal"],
      "readonly",
    );
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(
        inspectionTransaction.objectStore("attempts").get("attempt_1"),
      ),
    ).toMatchObject({ currentSnapshot: entitlement().initialSnapshot });
    expect(
      await idbRequest(
        inspectionTransaction
          .objectStore("journal")
          .get(["attempt_1", entry.spoolEntryId]),
      ),
    ).toMatchObject({
      commitId: changedCommitId,
      status: "signing",
      signature: null,
      finalisedAt: null,
    });
    await inspectionComplete;
  });

  it("does not recover a later reservation when an earlier sequence is missing", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry();
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });
    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: {
        ...firstEntry.snapshot,
        totalTimeSeconds: 30,
      },
    });
    const { fingerprint } =
      await fingerprintOfflineScormSpoolEntry(secondEntry);
    const reservation = await store.reserveSpoolEntry({
      attemptId: "attempt_1",
      entry: secondEntry,
      fingerprint,
      candidateCommitId: "commit_sequence_two_0001",
      reservedAt: baseInstant,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    corruptionTransaction
      .objectStore("journal")
      .delete(["attempt_1", firstEntry.spoolEntryId]);
    corruptionTransaction.commit();
    await corruptionComplete;

    await expect(
      store.finaliseJournalEntry({
        reservation,
        signature: "a".repeat(86),
        finalisedAt: baseInstant,
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });
    await expect(
      runtime.importSpoolEntry({ attemptId: "attempt_1", entry: secondEntry }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    expect(await runtime.recoverSigningReservations("attempt_1")).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });
    expect(await runtime.recoverSigningReservations()).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });

    const inspectionTransaction = database.transaction("journal", "readonly");
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(
        inspectionTransaction
          .objectStore("journal")
          .get(["attempt_1", secondEntry.spoolEntryId]),
      ),
    ).toMatchObject({ status: "signing", signature: null });
    await inspectionComplete;
  });

  it("rejects a signing reservation that precedes finalised journal history", async () => {
    const store = createStore();
    await prepareStore(store);
    const runtime = new OfflineScormTrustedRuntime(store, {
      now: () => new Date(baseInstant),
    });
    const firstEntry = spoolEntry();
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: firstEntry,
    });
    const secondEntry = spoolEntry({
      spoolEntryId: "spool_entry_000002",
      ordinal: 2,
      sessionElapsedSeconds: 30,
      sessionTimeDeltaSeconds: 10,
      snapshot: { ...firstEntry.snapshot, totalTimeSeconds: 30 },
    });
    await runtime.importSpoolEntry({
      attemptId: "attempt_1",
      entry: secondEntry,
    });

    const database = await store.open();
    const corruptionTransaction = database.transaction("journal", "readwrite");
    const corruptionComplete = idbTransaction(corruptionTransaction);
    const journal = corruptionTransaction.objectStore("journal");
    const firstRecord = (await idbRequest(
      journal.get(["attempt_1", firstEntry.spoolEntryId]),
    )) as Record<string, unknown>;
    const corruptedFirstRecord = {
      ...firstRecord,
      status: "signing",
      signature: null,
      finalisedAt: null,
    } as unknown as OfflineScormJournalRecord;
    journal.put(corruptedFirstRecord);
    corruptionTransaction.commit();
    await corruptionComplete;

    expect(await store.listSigningReservations("attempt_1")).toEqual({
      reservations: [],
      corruptAttemptIds: ["attempt_1"],
      unattributedCorruptRecords: 0,
    });
    expect(await runtime.recoverSigningReservations("attempt_1")).toEqual({
      acknowledgements: [],
      failures: [{ attemptId: "attempt_1", code: "journal_corrupt" }],
      unattributedCorruptRecords: 0,
    });
    await expect(
      store.finaliseJournalEntry({
        reservation: corruptedFirstRecord,
        signature: "a".repeat(86),
        finalisedAt: "2026-09-16T01:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "journal_corrupt" });

    const inspectionTransaction = database.transaction(
      ["attempts", "journal"],
      "readonly",
    );
    const inspectionComplete = idbTransaction(inspectionTransaction);
    expect(
      await idbRequest(
        inspectionTransaction.objectStore("attempts").get("attempt_1"),
      ),
    ).toMatchObject({ currentSnapshot: secondEntry.snapshot });
    expect(
      await idbRequest(
        inspectionTransaction
          .objectStore("journal")
          .get(["attempt_1", firstEntry.spoolEntryId]),
      ),
    ).toMatchObject({ status: "signing", signature: null });
    expect(
      await idbRequest(
        inspectionTransaction
          .objectStore("journal")
          .get(["attempt_1", secondEntry.spoolEntryId]),
      ),
    ).toMatchObject({ status: "pending" });
    await inspectionComplete;
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
      unattributedCorruptRecords: 0,
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
