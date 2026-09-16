import {
  OFFLINE_SCORM_TRUSTED_DATABASE_NAME,
  OFFLINE_SCORM_TRUSTED_DATABASE_VERSION,
  OfflineScormRuntimeError,
  offlineScormPackageRecordSchema,
  offlineScormReceiptSchema,
  offlineScormSpoolEntrySchema,
  offlineScormTrustedEntitlementSchema,
  offlineScormTrustedStoreNames,
  parseStoredOfflineScormSignedCommit,
  parseStoredOfflineScormUnsignedCommit,
  type OfflineScormAttemptState,
  type OfflineScormDeviceKeyRecord,
  type OfflineScormJournalRecord,
  type OfflineScormLaunchState,
  type OfflineScormPackageRecord,
  type OfflineScormReceipt,
  type OfflineScormRuntimeErrorCode,
  type OfflineScormSigningReservationScan,
  type OfflineScormTrustedEntitlement,
  type OfflineScormTrustedStore,
} from "#/features/scorm/offline-scorm-trusted-runtime";
import { scormProgressInputSchema } from "#/features/scorm/scorm.schema";
import { instantIsoSchema } from "#/features/shared/time.schema";
import { z } from "#/validation/zod";

const MAXIMUM_SEQUENCE = 2_147_483_647;
const journalKeyPath = ["attemptId", "spoolEntryId"] as const;
const launchKeyPath = ["attemptId", "launchSessionId"] as const;
const receiptKeyPath = ["attemptId", "commitId"] as const;

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );
const canonicalInstantSchema = z.pipe(
  instantIsoSchema,
  z.transform((value) => new Date(value).toISOString()),
);
const runtimeErrorCodeSchema = z.enum([
  "attempt_unavailable",
  "device_key_unavailable",
  "journal_corrupt",
  "launch_history_invalid",
  "signing_failed",
  "signing_in_progress",
  "storage_failed",
]);
const attemptStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptId: internalIdSchema,
  entitlementId: internalIdSchema,
  nextClientSequence: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(MAXIMUM_SEQUENCE)),
  currentSnapshot: scormProgressInputSchema,
  lastErrorCode: z.nullable(runtimeErrorCodeSchema),
  updatedAt: canonicalInstantSchema,
});
const launchStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptId: internalIdSchema,
  launchSessionId: z
    .string()
    .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u)),
  nextExpectedOrdinal: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(MAXIMUM_SEQUENCE)),
  elapsedHighwaterSeconds: z
    .number()
    .check(z.int(), z.nonnegative(), z.maximum(31_536_000)),
  updatedAt: canonicalInstantSchema,
});
const journalRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptId: internalIdSchema,
  entitlementId: internalIdSchema,
  installationId: internalIdSchema,
  spoolEntryId: z
    .string()
    .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u)),
  spoolFingerprint: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  clientSequence: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(MAXIMUM_SEQUENCE)),
  commitId: z
    .string()
    .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u)),
  unsignedCommit: z.unknown(),
  status: z.enum(["signing", "pending", "acknowledged"]),
  signature: z.nullable(
    z.string().check(z.length(86), z.regex(/^[A-Za-z0-9_-]+$/u)),
  ),
  reservedAt: canonicalInstantSchema,
  finalisedAt: z.nullable(canonicalInstantSchema),
});

function parseAttemptState(input: unknown): OfflineScormAttemptState {
  return attemptStateSchema.parse(input);
}

function parseLaunchState(input: unknown): OfflineScormLaunchState {
  return launchStateSchema.parse(input);
}

function parseJournalRecord(input: unknown): OfflineScormJournalRecord {
  const record = journalRecordSchema.parse(input);
  const unsignedCommit = parseStoredOfflineScormUnsignedCommit(
    record.unsignedCommit,
  );
  if (
    record.attemptId !== unsignedCommit.attemptId ||
    record.entitlementId !== unsignedCommit.entitlementId ||
    record.commitId !== unsignedCommit.commitId ||
    record.clientSequence !== unsignedCommit.clientSequence
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The journal envelope does not match its canonical commit",
    );
  if (record.status === "signing") {
    if (record.signature !== null || record.finalisedAt !== null)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "A signing reservation contains finalised fields",
      );
  } else {
    if (record.signature === null || record.finalisedAt === null)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "A finalised journal record is missing signed fields",
      );
    parseStoredOfflineScormSignedCommit({
      unsignedCommit,
      signature: record.signature,
    });
  }
  return { ...record, unsignedCommit };
}

function parseDeviceKeyRecord(input: unknown): OfflineScormDeviceKeyRecord {
  if (!input || typeof input !== "object")
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device key is invalid",
    );
  const record = input as Partial<OfflineScormDeviceKeyRecord>;
  const installationId = internalIdSchema.parse(record.installationId);
  const learnerId = internalIdSchema.parse(record.learnerId);
  const createdAt = canonicalInstantSchema.parse(record.createdAt);
  if (
    record.schemaVersion !== 1 ||
    !(record.publicKeySpki instanceof Uint8Array) ||
    !record.publicKeySha256 ||
    !/^[a-f0-9]{64}$/u.test(record.publicKeySha256) ||
    !record.privateKey ||
    record.privateKey.type !== "private" ||
    record.privateKey.extractable ||
    record.privateKey.algorithm.name !== "ECDSA" ||
    !(record.privateKey.usages as readonly string[]).includes("sign")
  )
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device key is invalid",
    );
  const algorithm = record.privateKey.algorithm as EcKeyAlgorithm;
  if (algorithm.namedCurve !== "P-256")
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device key uses an unsupported curve",
    );
  return {
    schemaVersion: 1,
    installationId,
    learnerId,
    privateKey: record.privateKey,
    publicKeySpki: record.publicKeySpki,
    publicKeySha256: record.publicKeySha256,
    createdAt,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
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
        reject(request.error ?? new Error("IndexedDB request failed"));
      },
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      "complete",
      () => {
        resolve();
      },
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      },
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      },
      { once: true },
    );
  });
}

function abortTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // A transaction that has already committed or aborted needs no cleanup.
  }
}

function storedValue<T>(value: T | undefined): T | undefined {
  return value;
}

function sameEntitlement(
  first: OfflineScormTrustedEntitlement,
  second: OfflineScormTrustedEntitlement,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (const [index, byte] of first.entries())
    if (byte !== second[index]) return false;
  return true;
}

function completed(
  snapshot: OfflineScormAttemptState["currentSnapshot"],
): boolean {
  return (
    snapshot.lessonStatus === "completed" || snapshot.lessonStatus === "passed"
  );
}

function hasContiguousJournalSequence(
  records: readonly OfflineScormJournalRecord[],
  nextClientSequence: number,
): boolean {
  const sequences = records
    .map((record) => record.clientSequence)
    .sort((first, second) => first - second);
  return (
    sequences.length === nextClientSequence - 1 &&
    sequences.every((sequence, index) => sequence === index + 1)
  );
}

function parseAttemptJournalRecords(
  values: readonly unknown[],
  attemptId: string,
): OfflineScormJournalRecord[] {
  return values.map((value) => {
    let record: OfflineScormJournalRecord;
    try {
      record = parseJournalRecord(value);
    } catch (error) {
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The attempt contains a corrupt journal record",
        { cause: error },
      );
    }
    if (record.attemptId !== attemptId)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The journal record does not match its attempt",
      );
    return record;
  });
}

function asStorageFailure(error: unknown): OfflineScormRuntimeError {
  return error instanceof OfflineScormRuntimeError
    ? error
    : new OfflineScormRuntimeError(
        "storage_failed",
        "The trusted offline store operation failed",
        { cause: error },
      );
}

export class OfflineScormIndexedDbStore implements OfflineScormTrustedStore {
  readonly #databaseName: string;
  readonly #factory: IDBFactory;
  #databasePromise: Promise<IDBDatabase> | undefined;

  constructor(
    options: {
      databaseName?: string;
      factory?: IDBFactory;
    } = {},
  ) {
    this.#databaseName =
      options.databaseName ?? OFFLINE_SCORM_TRUSTED_DATABASE_NAME;
    this.#factory = options.factory ?? globalThis.indexedDB;
  }

  async open(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(
        this.#databaseName,
        OFFLINE_SCORM_TRUSTED_DATABASE_VERSION,
      );
      request.addEventListener(
        "upgradeneeded",
        () => {
          const database = request.result;
          if (request.transaction?.db.version !== 1)
            throw new Error("Unsupported offline SCORM database version");
          const installations = database.createObjectStore("installations", {
            keyPath: "installationId",
          });
          installations.createIndex("byCreatedAt", "createdAt");
          installations.createIndex("byLearnerId", "learnerId", {
            unique: true,
          });
          const entitlements = database.createObjectStore("entitlements", {
            keyPath: "entitlementId",
          });
          entitlements.createIndex("byAttemptId", "attemptId", {
            unique: true,
          });
          const attempts = database.createObjectStore("attempts", {
            keyPath: "attemptId",
          });
          attempts.createIndex("byEntitlementId", "entitlementId", {
            unique: true,
          });
          const launches = database.createObjectStore("launches", {
            keyPath: [...launchKeyPath],
          });
          launches.createIndex("byAttemptId", "attemptId");
          const journal = database.createObjectStore("journal", {
            keyPath: [...journalKeyPath],
          });
          journal.createIndex(
            "byAttemptSequence",
            ["attemptId", "clientSequence"],
            { unique: true },
          );
          journal.createIndex("byAttemptId", "attemptId");
          journal.createIndex("byCommitId", "commitId", { unique: true });
          const packages = database.createObjectStore("packages", {
            keyPath: "attemptId",
          });
          packages.createIndex("byEntitlementId", "entitlementId", {
            unique: true,
          });
          const receipts = database.createObjectStore("receipts", {
            keyPath: [...receiptKeyPath],
          });
          receipts.createIndex(
            "byAttemptSequence",
            ["attemptId", "clientSequence"],
            { unique: true },
          );
        },
        { once: true },
      );
      request.addEventListener(
        "success",
        () => {
          const database = request.result;
          database.addEventListener(
            "versionchange",
            () => {
              database.close();
              this.#databasePromise = undefined;
            },
            { once: true },
          );
          resolve(database);
        },
        { once: true },
      );
      request.addEventListener(
        "error",
        () => {
          reject(request.error ?? new Error("IndexedDB open failed"));
        },
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => {
          reject(new Error("IndexedDB upgrade is blocked"));
        },
        { once: true },
      );
    });
    try {
      return await this.#databasePromise;
    } catch (error) {
      this.#databasePromise = undefined;
      throw asStorageFailure(error);
    }
  }

  async close(): Promise<void> {
    const database = await this.#databasePromise;
    database?.close();
    this.#databasePromise = undefined;
  }

  async putInstallation(record: OfflineScormDeviceKeyRecord): Promise<void> {
    const parsed = parseDeviceKeyRecord(record);
    try {
      const database = await this.open();
      const transaction = database.transaction("installations", "readwrite");
      const completedTransaction = transactionComplete(transaction);
      try {
        const store = transaction.objectStore("installations");
        const existing = await requestResult<unknown>(
          store.get(parsed.installationId),
        );
        if (existing !== undefined) {
          const parsedExisting = parseDeviceKeyRecord(existing);
          if (
            parsedExisting.learnerId !== parsed.learnerId ||
            parsedExisting.publicKeySha256 !== parsed.publicKeySha256 ||
            !sameBytes(parsedExisting.publicKeySpki, parsed.publicKeySpki)
          )
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The installation identifier is already bound to another key",
            );
        } else {
          const installationCount = await requestResult(store.count());
          if (installationCount > 0)
            throw new OfflineScormRuntimeError(
              "device_key_unavailable",
              "Another learner installation already owns this trusted store",
            );
          store.add(parsed);
        }
        transaction.commit();
        await completedTransaction;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async getInstallation(
    installationId: string,
  ): Promise<OfflineScormDeviceKeyRecord | undefined> {
    const parsedInstallationId = internalIdSchema.parse(installationId);
    try {
      const database = await this.open();
      const transaction = database.transaction("installations", "readonly");
      const value = await requestResult<unknown>(
        transaction.objectStore("installations").get(parsedInstallationId),
      );
      await transactionComplete(transaction);
      return value === undefined ? undefined : parseDeviceKeyRecord(value);
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async putEntitlement(input: OfflineScormTrustedEntitlement): Promise<void> {
    const entitlement = offlineScormTrustedEntitlementSchema.parse(input);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["installations", "entitlements", "attempts"],
        "readwrite",
      );
      const completed = transactionComplete(transaction);
      try {
        const installation = await requestResult<unknown>(
          transaction
            .objectStore("installations")
            .get(entitlement.installationId),
        );
        if (installation === undefined)
          throw new OfflineScormRuntimeError(
            "device_key_unavailable",
            "The entitlement installation key is unavailable",
          );
        const deviceKey = parseDeviceKeyRecord(installation);
        if (
          deviceKey.learnerId !== entitlement.learnerId ||
          deviceKey.publicKeySha256 !== entitlement.devicePublicKeySha256
        )
          throw new OfflineScormRuntimeError(
            "device_key_unavailable",
            "The entitlement does not match its learner installation key",
          );
        const entitlementStore = transaction.objectStore("entitlements");
        const existingEntitlement = storedValue(
          await requestResult<unknown>(
            entitlementStore.get(entitlement.entitlementId),
          ),
        );
        if (existingEntitlement !== undefined) {
          const parsedExisting =
            offlineScormTrustedEntitlementSchema.parse(existingEntitlement);
          if (!sameEntitlement(parsedExisting, entitlement))
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The entitlement identifier was reused with different content",
            );
          transaction.commit();
          await completed;
          return;
        }
        const existingAttempt = await requestResult<unknown>(
          transaction.objectStore("attempts").get(entitlement.attemptId),
        );
        if (existingAttempt !== undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The attempt already belongs to another local entitlement",
          );
        const attempt: OfflineScormAttemptState = {
          schemaVersion: 1,
          attemptId: entitlement.attemptId,
          entitlementId: entitlement.entitlementId,
          nextClientSequence: 1,
          currentSnapshot: entitlement.initialSnapshot,
          lastErrorCode: null,
          updatedAt: entitlement.issuedAt,
        };
        entitlementStore.add(entitlement);
        transaction.objectStore("attempts").add(attempt);
        transaction.commit();
        await completed;
      } catch (error) {
        abortTransaction(transaction);
        await completed.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async reserveSpoolEntry(input: {
    attemptId: string;
    entry: Parameters<typeof offlineScormSpoolEntrySchema.parse>[0];
    fingerprint: string;
    candidateCommitId: string;
    reservedAt: string;
  }): Promise<OfflineScormJournalRecord> {
    const attemptId = internalIdSchema.parse(input.attemptId);
    const entry = offlineScormSpoolEntrySchema.parse(input.entry);
    const fingerprint = z
      .string()
      .check(z.regex(/^[a-f0-9]{64}$/u))
      .parse(input.fingerprint);
    const candidateCommitId = z
      .string()
      .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u))
      .parse(input.candidateCommitId);
    const reservedAt = canonicalInstantSchema.parse(input.reservedAt);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["entitlements", "attempts", "launches", "journal"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const journalStore = transaction.objectStore("journal");
        const existing = await requestResult<unknown>(
          journalStore.get([attemptId, entry.spoolEntryId]),
        );
        let parsedExisting: OfflineScormJournalRecord | undefined;
        if (existing !== undefined) {
          parsedExisting = parseJournalRecord(existing);
          if (parsedExisting.spoolFingerprint !== fingerprint)
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The spool identifier was reused with different content",
            );
        }
        const attemptValue = await requestResult<unknown>(
          transaction.objectStore("attempts").get(attemptId),
        );
        if (attemptValue === undefined)
          throw new OfflineScormRuntimeError(
            "attempt_unavailable",
            "The trusted attempt is unavailable",
          );
        const attempt = parseAttemptState(attemptValue);
        const entitlementValue = await requestResult<unknown>(
          transaction.objectStore("entitlements").get(attempt.entitlementId),
        );
        if (entitlementValue === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The trusted entitlement is unavailable",
          );
        const entitlement =
          offlineScormTrustedEntitlementSchema.parse(entitlementValue);
        if (entitlement.attemptId !== attemptId)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The trusted entitlement does not match its attempt",
          );
        const attemptJournalValues = await requestResult<unknown[]>(
          journalStore.index("byAttemptId").getAll(attemptId),
        );
        const attemptJournalRecords = parseAttemptJournalRecords(
          attemptJournalValues,
          attemptId,
        );
        if (
          !hasContiguousJournalSequence(
            attemptJournalRecords,
            attempt.nextClientSequence,
          )
        )
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The local journal sequence is not contiguous",
          );
        if (parsedExisting) {
          transaction.commit();
          await completedTransaction;
          return parsedExisting;
        }
        if (attemptJournalRecords.some((record) => record.status === "signing"))
          throw new OfflineScormRuntimeError(
            "signing_in_progress",
            "An earlier journal reservation must finish signing first",
          );
        const launchStore = transaction.objectStore("launches");
        const launchValue = await requestResult<unknown>(
          launchStore.get([attemptId, entry.launchSessionId]),
        );
        const launch =
          launchValue === undefined
            ? {
                schemaVersion: 1 as const,
                attemptId,
                launchSessionId: entry.launchSessionId,
                nextExpectedOrdinal: 1,
                elapsedHighwaterSeconds: 0,
                updatedAt: reservedAt,
              }
            : parseLaunchState(launchValue);
        const expectedDelta =
          entry.sessionElapsedSeconds - launch.elapsedHighwaterSeconds;
        if (
          entry.ordinal !== launch.nextExpectedOrdinal ||
          expectedDelta < 0 ||
          entry.sessionTimeDeltaSeconds !== expectedDelta ||
          entry.snapshot.totalTimeSeconds !==
            attempt.currentSnapshot.totalTimeSeconds + expectedDelta
        )
          throw new OfflineScormRuntimeError(
            "launch_history_invalid",
            "The spool entry is not the next non-overlapping launch checkpoint",
          );
        if (completed(attempt.currentSnapshot) && !completed(entry.snapshot))
          throw new OfflineScormRuntimeError(
            "launch_history_invalid",
            "Local completion cannot regress",
          );
        if (attempt.nextClientSequence >= MAXIMUM_SEQUENCE)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The local journal sequence is exhausted",
          );
        if (launch.nextExpectedOrdinal >= MAXIMUM_SEQUENCE)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The local launch ordinal is exhausted",
          );
        const unsignedCommit = parseStoredOfflineScormUnsignedCommit({
          schemaVersion: 1,
          entitlementId: entitlement.entitlementId,
          attemptId,
          commitId: candidateCommitId,
          clientSequence: attempt.nextClientSequence,
          historyBaseRevision: entitlement.historyBaseRevision,
          runtimeVersion: entitlement.runtimeVersion,
          offering: entitlement.offering,
          packageVersionId: entitlement.packageVersionId,
          packageSha256: entitlement.packageSha256,
          reason: entry.reason,
          snapshot: entry.snapshot,
          launchSessionId: entry.launchSessionId,
          sessionElapsedSeconds: entry.sessionElapsedSeconds,
          sessionTimeDeltaSeconds: entry.sessionTimeDeltaSeconds,
          clientObservedAt: entry.clientObservedAt,
        });
        const record: OfflineScormJournalRecord = {
          schemaVersion: 1,
          attemptId,
          entitlementId: entitlement.entitlementId,
          installationId: entitlement.installationId,
          spoolEntryId: entry.spoolEntryId,
          spoolFingerprint: fingerprint,
          clientSequence: attempt.nextClientSequence,
          commitId: candidateCommitId,
          unsignedCommit,
          status: "signing",
          signature: null,
          reservedAt,
          finalisedAt: null,
        };
        journalStore.add(record);
        transaction.objectStore("attempts").put({
          ...attempt,
          nextClientSequence: attempt.nextClientSequence + 1,
          updatedAt: reservedAt,
        } satisfies OfflineScormAttemptState);
        launchStore.put({
          ...launch,
          nextExpectedOrdinal: launch.nextExpectedOrdinal + 1,
          elapsedHighwaterSeconds: entry.sessionElapsedSeconds,
          updatedAt: reservedAt,
        } satisfies OfflineScormLaunchState);
        transaction.commit();
        await completedTransaction;
        return record;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async finaliseJournalEntry(input: {
    attemptId: string;
    spoolEntryId: string;
    fingerprint: string;
    signature: string;
    finalisedAt: string;
  }): Promise<OfflineScormJournalRecord> {
    const attemptId = internalIdSchema.parse(input.attemptId);
    const finalisedAt = canonicalInstantSchema.parse(input.finalisedAt);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["attempts", "journal"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const journalStore = transaction.objectStore("journal");
        const value = await requestResult<unknown>(
          journalStore.get([attemptId, input.spoolEntryId]),
        );
        if (value === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The signing reservation is unavailable",
          );
        const record = parseJournalRecord(value);
        if (record.spoolFingerprint !== input.fingerprint)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The signing reservation fingerprint changed",
          );
        const attemptValue = await requestResult<unknown>(
          transaction.objectStore("attempts").get(attemptId),
        );
        if (attemptValue === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The trusted attempt is unavailable",
          );
        const attempt = parseAttemptState(attemptValue);
        const attemptJournalValues = await requestResult<unknown[]>(
          journalStore.index("byAttemptId").getAll(attemptId),
        );
        if (
          !hasContiguousJournalSequence(
            parseAttemptJournalRecords(attemptJournalValues, attemptId),
            attempt.nextClientSequence,
          )
        )
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The local journal sequence is not contiguous",
          );
        if (record.status !== "signing") {
          transaction.commit();
          await completedTransaction;
          return record;
        }
        const signedCommit = parseStoredOfflineScormSignedCommit({
          unsignedCommit: record.unsignedCommit,
          signature: input.signature,
        });
        const finalised: OfflineScormJournalRecord = {
          ...record,
          status: "pending",
          signature: signedCommit.signature,
          finalisedAt,
        };
        journalStore.put(finalised);
        transaction.objectStore("attempts").put({
          ...attempt,
          currentSnapshot: record.unsignedCommit.snapshot,
          lastErrorCode: null,
          updatedAt: finalisedAt,
        } satisfies OfflineScormAttemptState);
        transaction.commit();
        await completedTransaction;
        return finalised;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async listSigningReservations(
    attemptId?: string,
  ): Promise<OfflineScormSigningReservationScan> {
    const parsedAttemptId = attemptId
      ? internalIdSchema.parse(attemptId)
      : undefined;
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["attempts", "journal"],
        "readonly",
      );
      const completedTransaction = transactionComplete(transaction);
      const journal = transaction.objectStore("journal");
      const journalRequest = requestResult<unknown[]>(
        parsedAttemptId
          ? journal.index("byAttemptId").getAll(parsedAttemptId)
          : journal.getAll(),
      );
      const attemptStore = transaction.objectStore("attempts");
      const attemptRequest = parsedAttemptId
        ? requestResult<unknown>(attemptStore.get(parsedAttemptId))
        : requestResult<unknown[]>(attemptStore.getAll());
      const [values, attemptResult] = await Promise.all([
        journalRequest,
        attemptRequest,
      ]);
      await completedTransaction;
      const attemptValues = parsedAttemptId
        ? attemptResult === undefined
          ? []
          : [attemptResult]
        : (attemptResult as unknown[]);
      const corruptAttemptIds = new Set<string>();
      let unattributedCorruptRecords = 0;
      const attemptsById = new Map<string, OfflineScormAttemptState>();
      for (const value of attemptValues) {
        const envelopeAttemptId =
          parsedAttemptId ?? this.#storedEnvelopeAttemptId(value);
        if (!envelopeAttemptId) {
          unattributedCorruptRecords += 1;
          continue;
        }
        try {
          const attempt = parseAttemptState(value);
          attemptsById.set(attempt.attemptId, attempt);
        } catch {
          corruptAttemptIds.add(envelopeAttemptId);
        }
      }
      const recordsByAttemptId = new Map<string, OfflineScormJournalRecord[]>();
      for (const value of values) {
        try {
          const record = parseJournalRecord(value);
          const records = recordsByAttemptId.get(record.attemptId) ?? [];
          records.push(record);
          recordsByAttemptId.set(record.attemptId, records);
        } catch {
          const envelopeAttemptId =
            parsedAttemptId ?? this.#storedEnvelopeAttemptId(value);
          if (!envelopeAttemptId) {
            unattributedCorruptRecords += 1;
            continue;
          }
          corruptAttemptIds.add(envelopeAttemptId);
        }
      }
      for (const [attemptId, attempt] of attemptsById) {
        if (
          !hasContiguousJournalSequence(
            recordsByAttemptId.get(attemptId) ?? [],
            attempt.nextClientSequence,
          )
        )
          corruptAttemptIds.add(attemptId);
      }
      for (const attemptId of recordsByAttemptId.keys())
        if (!attemptsById.has(attemptId)) corruptAttemptIds.add(attemptId);
      const reservations: OfflineScormJournalRecord[] = [];
      for (const records of recordsByAttemptId.values())
        for (const record of records)
          if (
            record.status === "signing" &&
            !corruptAttemptIds.has(record.attemptId)
          )
            reservations.push(record);
      return {
        reservations: reservations.sort(
          (first, second) =>
            first.attemptId.localeCompare(second.attemptId) ||
            first.clientSequence - second.clientSequence,
        ),
        corruptAttemptIds: [...corruptAttemptIds].sort(),
        unattributedCorruptRecords,
      };
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  #storedEnvelopeAttemptId(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || !("attemptId" in value))
      return undefined;
    const parsed = internalIdSchema.safeParse(value.attemptId);
    return parsed.success ? parsed.data : undefined;
  }

  async markAttemptError(
    attemptId: string,
    errorCode: OfflineScormRuntimeErrorCode,
    updatedAt: string,
  ): Promise<void> {
    const parsedAttemptId = internalIdSchema.parse(attemptId);
    const parsedErrorCode = runtimeErrorCodeSchema.parse(errorCode);
    const parsedUpdatedAt = canonicalInstantSchema.parse(updatedAt);
    try {
      const database = await this.open();
      const transaction = database.transaction("attempts", "readwrite");
      const completedTransaction = transactionComplete(transaction);
      try {
        const store = transaction.objectStore("attempts");
        const value = await requestResult<unknown>(store.get(parsedAttemptId));
        if (value === undefined)
          throw new OfflineScormRuntimeError(
            "attempt_unavailable",
            "The trusted attempt is unavailable",
          );
        store.put({
          ...parseAttemptState(value),
          lastErrorCode: parsedErrorCode,
          updatedAt: parsedUpdatedAt,
        } satisfies OfflineScormAttemptState);
        transaction.commit();
        await completedTransaction;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async putPackage(input: OfflineScormPackageRecord): Promise<void> {
    const record = offlineScormPackageRecordSchema.parse(input);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["entitlements", "packages"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const entitlementValue = await requestResult<unknown>(
          transaction.objectStore("entitlements").get(record.entitlementId),
        );
        if (entitlementValue === undefined)
          throw new OfflineScormRuntimeError(
            "attempt_unavailable",
            "The package entitlement is unavailable",
          );
        const entitlement =
          offlineScormTrustedEntitlementSchema.parse(entitlementValue);
        if (
          entitlement.attemptId !== record.attemptId ||
          entitlement.packageVersionId !== record.packageVersionId ||
          entitlement.packageSha256 !== record.packageSha256
        )
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The package registry record does not match its entitlement",
          );
        const packageStore = transaction.objectStore("packages");
        const existingValue = await requestResult<unknown>(
          packageStore.get(record.attemptId),
        );
        if (existingValue !== undefined) {
          const existing = offlineScormPackageRecordSchema.parse(existingValue);
          if (
            existing.entitlementId !== record.entitlementId ||
            existing.packageVersionId !== record.packageVersionId ||
            existing.packageSha256 !== record.packageSha256 ||
            existing.packageOrigin !== record.packageOrigin ||
            existing.drainUrl !== record.drainUrl
          )
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The package registry identity cannot be replaced",
            );
        }
        packageStore.put(record);
        transaction.commit();
        await completedTransaction;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async putReceipt(input: OfflineScormReceipt): Promise<void> {
    const receipt = offlineScormReceiptSchema.parse(input);
    try {
      const database = await this.open();
      const transaction = database.transaction("receipts", "readwrite");
      const completedTransaction = transactionComplete(transaction);
      try {
        const store = transaction.objectStore("receipts");
        const existingValue = await requestResult<unknown>(
          store.get([receipt.attemptId, receipt.commitId]),
        );
        if (existingValue !== undefined) {
          const existing = offlineScormReceiptSchema.parse(existingValue);
          if (JSON.stringify(existing) !== JSON.stringify(receipt))
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The reconciliation receipt cannot be replaced",
            );
        } else store.add(receipt);
        transaction.commit();
        await completedTransaction;
      } catch (error) {
        abortTransaction(transaction);
        await completedTransaction.catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw asStorageFailure(error);
    }
  }
}

export function assertOfflineScormIndexedDbSchema(database: IDBDatabase): void {
  if (database.version !== OFFLINE_SCORM_TRUSTED_DATABASE_VERSION)
    throw new Error("Unexpected offline SCORM database version");
  for (const storeName of offlineScormTrustedStoreNames)
    if (!database.objectStoreNames.contains(storeName))
      throw new Error(`Offline SCORM store ${storeName} is unavailable`);
}
