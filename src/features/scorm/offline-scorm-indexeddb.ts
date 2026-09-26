import {
  canonicalizeOfflineScormCommit,
  type OfflineScormSignedCommit,
  type OfflineScormUnsignedCommit,
} from "#/features/scorm/offline-scorm-reconciliation";
import {
  OFFLINE_SCORM_TRUSTED_DATABASE_NAME,
  OFFLINE_SCORM_TRUSTED_DATABASE_VERSION,
  assertOfflineScormSigningReservationTail,
  assertSameOfflineScormJournalReservation,
  fingerprintOfflineScormCommit,
  OfflineScormRuntimeError,
  offlineScormPackageRecordSchema,
  offlineScormReceiptSchema,
  offlineScormSpoolEntrySchema,
  offlineScormTrustedEntitlementSchema,
  offlineScormTrustedStoreNames,
  parseStoredOfflineScormSignedCommit,
  parseStoredOfflineScormUnsignedCommit,
  verifyOfflineScormJournalRecord,
  type OfflineScormAttemptState,
  type OfflineScormAttemptJournalSnapshot,
  type OfflineScormDeviceKeyRecord,
  type OfflineScormJournalRecord,
  type OfflineScormLaunchState,
  type OfflineScormPackageRecord,
  type OfflineScormReceipt,
  type OfflineScormRuntimeErrorCode,
  type OfflineScormSpoolEntry,
  type OfflineScormSigningReservationScan,
  type OfflineScormTrustedEntitlement,
  type OfflineScormTrustedStore,
} from "#/features/scorm/offline-scorm-trusted-runtime";
import { getDomain } from "tldts";
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
type OfflineScormPackageStatus = OfflineScormPackageRecord["status"];
const packageStatusTransitions: Record<
  OfflineScormPackageStatus,
  ReadonlySet<OfflineScormPackageStatus>
> = {
  downloading: new Set([
    "downloading",
    "ready",
    "integrity_failed",
    "cleanup_pending",
  ]),
  ready: new Set(["ready", "integrity_failed", "cleanup_pending"]),
  integrity_failed: new Set([
    "integrity_failed",
    "downloading",
    "cleanup_pending",
  ]),
  cleanup_pending: new Set(["cleanup_pending", "cleared"]),
  cleared: new Set(["cleared"]),
};
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
  spoolEntry: z.unknown(),
  clientSequence: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(MAXIMUM_SEQUENCE)),
  commitId: z
    .string()
    .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u)),
  unsignedCommit: z.unknown(),
  status: z.enum(["signing", "pending", "acknowledged", "discarded"]),
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
  const spoolEntry = offlineScormSpoolEntrySchema.parse(record.spoolEntry);
  if (
    record.attemptId !== unsignedCommit.attemptId ||
    record.entitlementId !== unsignedCommit.entitlementId ||
    record.commitId !== unsignedCommit.commitId ||
    record.clientSequence !== unsignedCommit.clientSequence ||
    record.spoolEntryId !== spoolEntry.spoolEntryId
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
  return { ...record, spoolEntry, unsignedCommit };
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

function createUnsignedCommit(input: {
  entitlement: OfflineScormTrustedEntitlement;
  attemptId: string;
  commitId: string;
  clientSequence: number;
  entry: OfflineScormSpoolEntry;
}): OfflineScormUnsignedCommit {
  return parseStoredOfflineScormUnsignedCommit({
    schemaVersion: 1,
    entitlementId: input.entitlement.entitlementId,
    attemptId: input.attemptId,
    commitId: input.commitId,
    clientSequence: input.clientSequence,
    historyBaseRevision: input.entitlement.historyBaseRevision,
    runtimeVersion: input.entitlement.runtimeVersion,
    offering: input.entitlement.offering,
    packageVersionId: input.entitlement.packageVersionId,
    packageSha256: input.entitlement.packageSha256,
    reason: input.entry.reason,
    snapshot: input.entry.snapshot,
    launchSessionId: input.entry.launchSessionId,
    sessionElapsedSeconds: input.entry.sessionElapsedSeconds,
    sessionTimeDeltaSeconds: input.entry.sessionTimeDeltaSeconds,
    clientObservedAt: input.entry.clientObservedAt,
  });
}

function assertJournalRecordEntitlementBinding(
  record: OfflineScormJournalRecord,
  entitlement: OfflineScormTrustedEntitlement,
): void {
  const expectedCommit = createUnsignedCommit({
    entitlement,
    attemptId: entitlement.attemptId,
    commitId: record.commitId,
    clientSequence: record.clientSequence,
    entry: record.spoolEntry,
  });
  if (
    record.attemptId !== entitlement.attemptId ||
    record.entitlementId !== entitlement.entitlementId ||
    record.installationId !== entitlement.installationId ||
    canonicalizeOfflineScormCommit(record.unsignedCommit) !==
      canonicalizeOfflineScormCommit(expectedCommit)
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The journal record does not match its trusted spool and entitlement",
    );
}

function assertReceiptJournalBinding(input: {
  receipt: OfflineScormReceipt;
  record: OfflineScormJournalRecord;
  entitlement: OfflineScormTrustedEntitlement;
  requestFingerprint: string;
}): void {
  const { receipt, record, entitlement, requestFingerprint } = input;
  assertJournalRecordEntitlementBinding(record, entitlement);
  if (
    record.status === "signing" ||
    record.signature === null ||
    receipt.entitlementId !== entitlement.entitlementId ||
    receipt.attemptId !== entitlement.attemptId ||
    receipt.commitId !== record.commitId ||
    receipt.clientSequence !== record.clientSequence ||
    receipt.requestFingerprint !== requestFingerprint
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The reconciliation receipt does not match its signed journal record",
    );
  if (
    receipt.outcome === "accepted" &&
    (receipt.resultingAttemptRevision === null ||
      receipt.resultingAttemptRevision < entitlement.historyBaseRevision ||
      receipt.resultingAttemptRevision - entitlement.historyBaseRevision >
        receipt.clientSequence)
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The accepted receipt revision is outside its journal history",
    );
}

function assertReceiptHistory(input: {
  receipt: OfflineScormReceipt;
  storedReceipts: readonly OfflineScormReceipt[];
  entitlement: OfflineScormTrustedEntitlement;
}): void {
  const { receipt, storedReceipts, entitlement } = input;
  const attemptReceipts = storedReceipts
    .filter((storedReceipt) => storedReceipt.attemptId === receipt.attemptId)
    .toSorted((first, second) => first.clientSequence - second.clientSequence);
  const existing = attemptReceipts.find(
    (storedReceipt) => storedReceipt.commitId === receipt.commitId,
  );
  const completeHistory = existing
    ? attemptReceipts
    : [...attemptReceipts, receipt].toSorted(
        (first, second) => first.clientSequence - second.clientSequence,
      );
  let previousRevision = entitlement.historyBaseRevision;
  let terminalReceiptSeen = false;
  for (const [index, historicalReceipt] of completeHistory.entries()) {
    if (
      historicalReceipt.entitlementId !== entitlement.entitlementId ||
      historicalReceipt.attemptId !== entitlement.attemptId ||
      historicalReceipt.clientSequence !== index + 1 ||
      terminalReceiptSeen
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The reconciliation receipt history is not contiguous",
      );
    if (historicalReceipt.outcome !== "accepted") {
      terminalReceiptSeen = true;
      continue;
    }
    const resultingRevision = historicalReceipt.resultingAttemptRevision;
    if (
      resultingRevision === null ||
      resultingRevision < previousRevision ||
      resultingRevision > previousRevision + 1
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The accepted receipt revision regresses or skips journal history",
      );
    previousRevision = resultingRevision;
  }
}

function receiptForRecord(
  record: OfflineScormJournalRecord,
  receipts: readonly OfflineScormReceipt[],
): OfflineScormReceipt | undefined {
  const receipt = receipts.find(
    (candidate) => candidate.clientSequence === record.clientSequence,
  );
  if (receipt && receipt.commitId !== record.commitId)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The reconciliation receipt sequence does not match its journal record",
    );
  return receipt;
}

function terminalReceiptForDiscard(
  records: readonly OfflineScormJournalRecord[],
  receipts: readonly OfflineScormReceipt[],
): OfflineScormReceipt {
  const terminalReceipts = receipts.filter(
    (receipt) => receipt.outcome !== "accepted",
  );
  if (terminalReceipts.length !== 1)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "A terminal journal discard requires one retained terminal receipt",
    );
  const terminalReceipt = terminalReceipts[0];
  if (!terminalReceipt)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The terminal reconciliation receipt is unavailable",
    );
  for (const record of records) {
    const receipt = receiptForRecord(record, receipts);
    if (record.clientSequence < terminalReceipt.clientSequence) {
      if (record.status !== "acknowledged" || receipt?.outcome !== "accepted")
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "Journal evidence before a terminal receipt is not acknowledged",
        );
    } else if (record.clientSequence === terminalReceipt.clientSequence) {
      if (
        receipt?.commitId !== terminalReceipt.commitId ||
        (record.status !== "acknowledged" && record.status !== "discarded")
      )
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The terminal receipt does not match its acknowledged journal record",
        );
    } else if (
      receipt !== undefined ||
      (record.status !== "pending" && record.status !== "discarded")
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The journal tail after a terminal receipt cannot be reconciled",
      );
  }
  return terminalReceipt;
}

function assertJournalReadyForCleanup(
  records: readonly OfflineScormJournalRecord[],
  receipts: readonly OfflineScormReceipt[],
): void {
  if (records.some((record) => record.status === "discarded")) {
    const terminal = terminalReceiptForDiscard(records, receipts);
    if (
      records.some(
        (record) =>
          record.clientSequence >= terminal.clientSequence &&
          record.status !== "discarded",
      )
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The terminal journal tail was not explicitly discarded",
      );
    return;
  }
  if (
    records.some((record) => {
      const receipt = receiptForRecord(record, receipts);
      return (
        record.status !== "acknowledged" || receipt?.outcome !== "accepted"
      );
    }) ||
    receipts.length !== records.length
  )
    throw new OfflineScormRuntimeError(
      "signing_in_progress",
      "Pending offline progress must be synchronized before local cleanup",
    );
}

function assertPackageOriginAvailable(
  record: OfflineScormPackageRecord,
  storedPackages: readonly OfflineScormPackageRecord[],
): void {
  const packageHostname = new URL(record.packageOrigin).hostname;
  const packageSite =
    getDomain(packageHostname, { allowPrivateDomains: true }) ??
    (packageHostname === "localhost" || packageHostname === "127.0.0.1"
      ? packageHostname
      : null);
  if (!packageSite)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The package origin has no registrable-site boundary",
    );
  if (
    record.status !== "cleared" &&
    storedPackages.some((storedPackage) => {
      if (
        storedPackage.attemptId === record.attemptId ||
        storedPackage.status === "cleared"
      )
        return false;
      const storedHostname = new URL(storedPackage.packageOrigin).hostname;
      const storedSite =
        getDomain(storedHostname, { allowPrivateDomains: true }) ??
        storedHostname;
      return storedSite === packageSite;
    })
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The package registrable site is already assigned to another active attempt",
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

function sameAttemptState(
  first: OfflineScormAttemptState,
  second: OfflineScormAttemptState,
): boolean {
  return (
    first.attemptId === second.attemptId &&
    first.entitlementId === second.entitlementId &&
    first.nextClientSequence === second.nextClientSequence &&
    JSON.stringify(first.currentSnapshot) ===
      JSON.stringify(second.currentSnapshot) &&
    first.lastErrorCode === second.lastErrorCode &&
    first.updatedAt === second.updatedAt
  );
}

function parseAttemptLaunchStates(
  values: readonly unknown[],
  attemptId: string,
): OfflineScormLaunchState[] {
  return values.map((value) => {
    let launch: OfflineScormLaunchState;
    try {
      launch = parseLaunchState(value);
    } catch (error) {
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The attempt contains a corrupt launch projection",
        { cause: error },
      );
    }
    if (launch.attemptId !== attemptId)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The launch projection does not match its attempt",
      );
    return launch;
  });
}

function assertLaunchProjectionsMatchJournal(
  records: readonly OfflineScormJournalRecord[],
  launches: readonly OfflineScormLaunchState[],
  attemptId: string,
): void {
  const expectedBySessionId = new Map<
    string,
    Omit<OfflineScormLaunchState, "schemaVersion" | "attemptId">
  >();
  for (const record of records.toSorted(
    (first, second) => first.clientSequence - second.clientSequence,
  )) {
    const entry = record.spoolEntry;
    const previous = expectedBySessionId.get(entry.launchSessionId) ?? {
      launchSessionId: entry.launchSessionId,
      nextExpectedOrdinal: 1,
      elapsedHighwaterSeconds: 0,
      updatedAt: record.reservedAt,
    };
    if (
      entry.ordinal !== previous.nextExpectedOrdinal ||
      entry.sessionElapsedSeconds < previous.elapsedHighwaterSeconds ||
      entry.sessionTimeDeltaSeconds !==
        entry.sessionElapsedSeconds - previous.elapsedHighwaterSeconds
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The journal launch history is not contiguous",
      );
    expectedBySessionId.set(entry.launchSessionId, {
      launchSessionId: entry.launchSessionId,
      nextExpectedOrdinal: entry.ordinal + 1,
      elapsedHighwaterSeconds: entry.sessionElapsedSeconds,
      updatedAt: record.reservedAt,
    });
  }
  if (launches.length !== expectedBySessionId.size)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The stored launch projections do not match journal history",
    );
  for (const launch of launches) {
    const expected = expectedBySessionId.get(launch.launchSessionId);
    if (
      !expected ||
      launch.attemptId !== attemptId ||
      launch.nextExpectedOrdinal !== expected.nextExpectedOrdinal ||
      launch.elapsedHighwaterSeconds !== expected.elapsedHighwaterSeconds ||
      launch.updatedAt !== expected.updatedAt
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "A stored launch projection does not match journal history",
      );
  }
}

function parseAttemptJournalRecords(
  values: readonly unknown[],
  attemptId: string,
  entitlement?: OfflineScormTrustedEntitlement,
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
    if (entitlement) assertJournalRecordEntitlementBinding(record, entitlement);
    return record;
  });
}

function assertPackageLifecycleUpdate(
  existing: OfflineScormPackageRecord,
  candidate: OfflineScormPackageRecord,
): void {
  const existingUpdatedAt = Date.parse(existing.updatedAt);
  const candidateUpdatedAt = Date.parse(candidate.updatedAt);
  if (candidateUpdatedAt < existingUpdatedAt)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "A stale package registry update cannot replace newer state",
    );
  if (
    candidateUpdatedAt === existingUpdatedAt &&
    candidate.status !== existing.status
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "Package registry transitions require an ordered update instant",
    );
  if (!packageStatusTransitions[existing.status].has(candidate.status))
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The package registry lifecycle cannot regress",
    );
  if (
    existing.cleanupReceiptSha256 !== undefined &&
    candidate.cleanupReceiptSha256 !== existing.cleanupReceiptSha256
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The retained package cleanup receipt cannot change",
    );
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
  readonly #keyRange: typeof IDBKeyRange;
  #databasePromise: Promise<IDBDatabase> | undefined;

  constructor(
    options: {
      databaseName?: string;
      factory?: IDBFactory;
      keyRange?: typeof IDBKeyRange;
    } = {},
  ) {
    this.#databaseName =
      options.databaseName ?? OFFLINE_SCORM_TRUSTED_DATABASE_NAME;
    this.#factory = options.factory ?? globalThis.indexedDB;
    this.#keyRange = options.keyRange ?? globalThis.IDBKeyRange;
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

  async findInstallationForLearner(
    learnerId: string,
  ): Promise<OfflineScormDeviceKeyRecord | undefined> {
    const parsedLearnerId = internalIdSchema.parse(learnerId);
    try {
      const database = await this.open();
      const transaction = database.transaction("installations", "readonly");
      const value = await requestResult<unknown>(
        transaction
          .objectStore("installations")
          .index("byLearnerId")
          .get(parsedLearnerId),
      );
      await transactionComplete(transaction);
      return value === undefined ? undefined : parseDeviceKeyRecord(value);
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async deleteUnusedInstallation(input: {
    installationId: string;
    learnerId: string;
  }): Promise<void> {
    const installationId = internalIdSchema.parse(input.installationId);
    const learnerId = internalIdSchema.parse(input.learnerId);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["installations", "entitlements"],
        "readwrite",
      );
      const completed = transactionComplete(transaction);
      try {
        const installations = transaction.objectStore("installations");
        const stored = await requestResult<unknown>(
          installations.get(installationId),
        );
        if (stored === undefined) {
          transaction.commit();
          await completed;
          return;
        }
        const installation = parseDeviceKeyRecord(stored);
        if (installation.learnerId !== learnerId)
          throw new OfflineScormRuntimeError(
            "device_key_unavailable",
            "The unused installation belongs to another learner",
          );
        const entitlements = await requestResult<unknown[]>(
          transaction.objectStore("entitlements").getAll(),
        );
        if (
          entitlements.some(
            (value) =>
              offlineScormTrustedEntitlementSchema.parse(value)
                .installationId === installationId,
          )
        )
          throw new OfflineScormRuntimeError(
            "device_key_unavailable",
            "An installation protecting offline evidence cannot be discarded",
          );
        installations.delete(installationId);
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
          entitlement,
        );
        assertOfflineScormSigningReservationTail(attemptJournalRecords);
        if (
          attemptJournalRecords.some((record) => record.status === "discarded")
        )
          throw new OfflineScormRuntimeError(
            "attempt_unavailable",
            "The terminal offline journal has been discarded",
          );
        const launchStore = transaction.objectStore("launches");
        const launchValues = await requestResult<unknown[]>(
          launchStore.index("byAttemptId").getAll(attemptId),
        );
        const launches = parseAttemptLaunchStates(launchValues, attemptId);
        assertLaunchProjectionsMatchJournal(
          attemptJournalRecords,
          launches,
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
          const expectedCommit = createUnsignedCommit({
            entitlement,
            attemptId,
            commitId: parsedExisting.commitId,
            clientSequence: parsedExisting.clientSequence,
            entry,
          });
          if (
            parsedExisting.installationId !== entitlement.installationId ||
            canonicalizeOfflineScormCommit(parsedExisting.unsignedCommit) !==
              canonicalizeOfflineScormCommit(expectedCommit)
          )
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The stored journal retry does not match trusted input",
            );
          transaction.commit();
          await completedTransaction;
          return parsedExisting;
        }
        if (attemptJournalRecords.some((record) => record.status === "signing"))
          throw new OfflineScormRuntimeError(
            "signing_in_progress",
            "An earlier journal reservation must finish signing first",
          );
        const existingLaunch = launches.find(
          (launch) => launch.launchSessionId === entry.launchSessionId,
        );
        const launch =
          existingLaunch === undefined
            ? {
                schemaVersion: 1 as const,
                attemptId,
                launchSessionId: entry.launchSessionId,
                nextExpectedOrdinal: 1,
                elapsedHighwaterSeconds: 0,
                updatedAt: reservedAt,
              }
            : existingLaunch;
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
        const unsignedCommit = createUnsignedCommit({
          entitlement,
          attemptId,
          commitId: candidateCommitId,
          clientSequence: attempt.nextClientSequence,
          entry,
        });
        const record: OfflineScormJournalRecord = {
          schemaVersion: 1,
          attemptId,
          entitlementId: entitlement.entitlementId,
          installationId: entitlement.installationId,
          spoolEntryId: entry.spoolEntryId,
          spoolFingerprint: fingerprint,
          spoolEntry: entry,
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
    reservation: OfflineScormJournalRecord;
    signature: string;
    finalisedAt: string;
  }): Promise<OfflineScormJournalRecord> {
    const expectedReservation = parseJournalRecord(input.reservation);
    if (expectedReservation.status !== "signing")
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "Only a signing reservation can be finalised",
      );
    const attemptId = expectedReservation.attemptId;
    const finalisedAt = canonicalInstantSchema.parse(input.finalisedAt);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["entitlements", "attempts", "journal"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const journalStore = transaction.objectStore("journal");
        const value = await requestResult<unknown>(
          journalStore.get([attemptId, expectedReservation.spoolEntryId]),
        );
        if (value === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The signing reservation is unavailable",
          );
        const record = parseJournalRecord(value);
        assertSameOfflineScormJournalReservation(expectedReservation, record);
        const attemptValue = await requestResult<unknown>(
          transaction.objectStore("attempts").get(attemptId),
        );
        if (attemptValue === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
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
          entitlement,
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
        assertOfflineScormSigningReservationTail(attemptJournalRecords);
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
    const parsedAttemptId =
      attemptId === undefined ? undefined : internalIdSchema.parse(attemptId);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["entitlements", "attempts", "journal"],
        "readonly",
      );
      const completedTransaction = transactionComplete(transaction);
      const journal = transaction.objectStore("journal");
      const journalRequest = requestResult<unknown[]>(
        parsedAttemptId !== undefined
          ? journal.index("byAttemptId").getAll(parsedAttemptId)
          : journal.getAll(),
      );
      const attemptStore = transaction.objectStore("attempts");
      const attemptRequest =
        parsedAttemptId !== undefined
          ? requestResult<unknown>(attemptStore.get(parsedAttemptId))
          : requestResult<unknown[]>(attemptStore.getAll());
      const entitlementRequest = requestResult<unknown[]>(
        transaction.objectStore("entitlements").getAll(),
      );
      const [values, attemptResult, entitlementValues] = await Promise.all([
        journalRequest,
        attemptRequest,
        entitlementRequest,
      ]);
      await completedTransaction;
      const attemptValues =
        parsedAttemptId !== undefined
          ? attemptResult === undefined
            ? []
            : [attemptResult]
          : (attemptResult as unknown[]);
      const corruptAttemptIds = new Set<string>();
      let unattributedCorruptRecords = 0;
      const attemptsById = new Map<string, OfflineScormAttemptState>();
      const entitlementsByAttemptId = new Map<
        string,
        OfflineScormTrustedEntitlement
      >();
      for (const value of entitlementValues) {
        const envelopeAttemptId = this.#storedEnvelopeAttemptId(value);
        if (!envelopeAttemptId) {
          if (parsedAttemptId === undefined) unattributedCorruptRecords += 1;
          continue;
        }
        if (
          parsedAttemptId !== undefined &&
          envelopeAttemptId !== parsedAttemptId
        )
          continue;
        try {
          const entitlement = offlineScormTrustedEntitlementSchema.parse(value);
          entitlementsByAttemptId.set(entitlement.attemptId, entitlement);
        } catch {
          corruptAttemptIds.add(envelopeAttemptId);
        }
      }
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
        const entitlement = entitlementsByAttemptId.get(attemptId);
        if (
          !entitlement ||
          entitlement.entitlementId !== attempt.entitlementId
        ) {
          corruptAttemptIds.add(attemptId);
          continue;
        }
        try {
          const records = recordsByAttemptId.get(attemptId) ?? [];
          for (const record of records)
            assertJournalRecordEntitlementBinding(record, entitlement);
          assertOfflineScormSigningReservationTail(records);
        } catch {
          corruptAttemptIds.add(attemptId);
          continue;
        }
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

  async getAttemptJournalSnapshot(
    attemptId: string,
  ): Promise<OfflineScormAttemptJournalSnapshot> {
    const parsedAttemptId = internalIdSchema.parse(attemptId);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["entitlements", "attempts", "launches", "journal"],
        "readonly",
      );
      const completedTransaction = transactionComplete(transaction);
      const attemptValue = await requestResult<unknown>(
        transaction.objectStore("attempts").get(parsedAttemptId),
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
      if (entitlement.attemptId !== parsedAttemptId)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The trusted entitlement does not match its attempt",
        );
      const values = await requestResult<unknown[]>(
        transaction
          .objectStore("journal")
          .index("byAttemptId")
          .getAll(parsedAttemptId),
      );
      const launchValues = await requestResult<unknown[]>(
        transaction
          .objectStore("launches")
          .index("byAttemptId")
          .getAll(parsedAttemptId),
      );
      await completedTransaction;
      const records = parseAttemptJournalRecords(
        values,
        parsedAttemptId,
        entitlement,
      );
      if (!hasContiguousJournalSequence(records, attempt.nextClientSequence))
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The local journal sequence is not contiguous",
        );
      assertOfflineScormSigningReservationTail(records);
      assertLaunchProjectionsMatchJournal(
        records,
        parseAttemptLaunchStates(launchValues, parsedAttemptId),
        parsedAttemptId,
      );
      return {
        attempt,
        entitlement,
        records: records.sort(
          (first, second) => first.clientSequence - second.clientSequence,
        ),
      };
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async listPendingSignedCommits(
    attemptId: string,
    limit = 16,
  ): Promise<OfflineScormSignedCommit[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw new Error("Offline SCORM reconciliation batch limit is invalid");
    const snapshot = await this.getAttemptJournalSnapshot(attemptId);
    const installation = await this.getInstallation(
      snapshot.entitlement.installationId,
    );
    if (!installation)
      throw new OfflineScormRuntimeError(
        "device_key_unavailable",
        "The device signing key is unavailable",
      );
    const pending = snapshot.records
      .filter((record) => record.status === "pending")
      .slice(0, limit);
    await Promise.all(
      pending.map((record) =>
        verifyOfflineScormJournalRecord(
          record,
          installation,
          globalThis.crypto,
        ),
      ),
    );
    return pending.map((record) =>
      parseStoredOfflineScormSignedCommit({
        unsignedCommit: record.unsignedCommit,
        signature: record.signature,
      }),
    );
  }

  async getPackage(
    attemptId: string,
  ): Promise<OfflineScormPackageRecord | undefined> {
    const parsedAttemptId = internalIdSchema.parse(attemptId);
    try {
      const database = await this.open();
      const transaction = database.transaction("packages", "readonly");
      const value = await requestResult<unknown>(
        transaction.objectStore("packages").get(parsedAttemptId),
      );
      await transactionComplete(transaction);
      return value === undefined
        ? undefined
        : offlineScormPackageRecordSchema.parse(value);
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async listPackages(): Promise<OfflineScormPackageRecord[]> {
    try {
      const database = await this.open();
      const transaction = database.transaction("packages", "readonly");
      const values = await requestResult<unknown[]>(
        transaction.objectStore("packages").getAll(),
      );
      await transactionComplete(transaction);
      return values.map((value) =>
        offlineScormPackageRecordSchema.parse(value),
      );
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async #listAttemptReceipts(
    attemptId: string,
  ): Promise<OfflineScormReceipt[]> {
    const parsedAttemptId = internalIdSchema.parse(attemptId);
    try {
      const database = await this.open();
      const transaction = database.transaction("receipts", "readonly");
      const values = await requestResult<unknown[]>(
        transaction
          .objectStore("receipts")
          .index("byAttemptSequence")
          .getAll(
            this.#keyRange.bound(
              [parsedAttemptId, 1],
              [parsedAttemptId, MAXIMUM_SEQUENCE],
            ),
          ),
      );
      await transactionComplete(transaction);
      return values.map((value) => offlineScormReceiptSchema.parse(value));
    } catch (error) {
      throw asStorageFailure(error);
    }
  }

  async getTerminalReceipt(
    attemptId: string,
  ): Promise<OfflineScormReceipt | undefined> {
    const receipts = await this.#listAttemptReceipts(attemptId);
    const terminal = receipts.filter(
      (receipt) => receipt.outcome !== "accepted",
    );
    if (terminal.length > 1)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The journal contains more than one terminal receipt",
      );
    return terminal[0];
  }

  async discardJournalAfterTerminalReceipt(attemptId: string): Promise<void> {
    const [snapshot, receipts] = await Promise.all([
      this.getAttemptJournalSnapshot(attemptId),
      this.#listAttemptReceipts(attemptId),
    ]);
    const terminal = terminalReceiptForDiscard(snapshot.records, receipts);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["journal", "receipts"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const journalStore = transaction.objectStore("journal");
        const [journalValues, receiptValues] = await Promise.all([
          requestResult<unknown[]>(
            journalStore.index("byAttemptId").getAll(attemptId),
          ),
          requestResult<unknown[]>(
            transaction
              .objectStore("receipts")
              .index("byAttemptSequence")
              .getAll(
                this.#keyRange.bound(
                  [attemptId, 1],
                  [attemptId, MAXIMUM_SEQUENCE],
                ),
              ),
          ),
        ]);
        const records = parseAttemptJournalRecords(
          journalValues,
          attemptId,
          snapshot.entitlement,
        );
        const currentReceipts = receiptValues.map((value) =>
          offlineScormReceiptSchema.parse(value),
        );
        const currentTerminal = terminalReceiptForDiscard(
          records,
          currentReceipts,
        );
        if (
          currentTerminal.commitId !== terminal.commitId ||
          currentTerminal.clientSequence !== terminal.clientSequence
        )
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The terminal journal receipt changed during discard",
          );
        for (const record of records)
          if (
            record.clientSequence >= currentTerminal.clientSequence &&
            record.status !== "discarded"
          )
            journalStore.put({
              ...record,
              status: "discarded",
            } satisfies OfflineScormJournalRecord);
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

  async clearAcknowledgedAttempt(attemptId: string): Promise<void> {
    const snapshot = await this.getAttemptJournalSnapshot(attemptId);
    if (
      snapshot.records.some(
        (record) => record.status === "signing" || record.status === "pending",
      )
    )
      throw new OfflineScormRuntimeError(
        "signing_in_progress",
        "Pending offline progress must be synchronized before local cleanup",
      );
    const packageRecord = await this.getPackage(attemptId);
    if (!packageRecord || packageRecord.status !== "cleared")
      throw new OfflineScormRuntimeError(
        "storage_failed",
        "The package site must be cleared before trusted attempt cleanup",
      );
    try {
      const database = await this.open();
      const transaction = database.transaction(
        [
          "entitlements",
          "installations",
          "attempts",
          "launches",
          "journal",
          "packages",
          "receipts",
        ],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const launchValues = (
          await requestResult<unknown[]>(
            transaction
              .objectStore("launches")
              .index("byAttemptId")
              .getAll(attemptId),
          )
        ).map(parseLaunchState);
        const journalValues = (
          await requestResult<unknown[]>(
            transaction
              .objectStore("journal")
              .index("byAttemptId")
              .getAll(attemptId),
          )
        ).map(parseJournalRecord);
        const receiptValues = (
          await requestResult<unknown[]>(
            transaction
              .objectStore("receipts")
              .index("byAttemptSequence")
              .getAll(
                this.#keyRange.bound(
                  [attemptId, 1],
                  [attemptId, MAXIMUM_SEQUENCE],
                ),
              ),
          )
        ).map((value) => offlineScormReceiptSchema.parse(value));
        const entitlementValues = (
          await requestResult<unknown[]>(
            transaction.objectStore("entitlements").getAll(),
          )
        ).map((value) => offlineScormTrustedEntitlementSchema.parse(value));
        assertJournalReadyForCleanup(journalValues, receiptValues);
        for (const launch of launchValues)
          transaction
            .objectStore("launches")
            .delete([launch.attemptId, launch.launchSessionId]);
        for (const record of journalValues)
          transaction
            .objectStore("journal")
            .delete([record.attemptId, record.spoolEntryId]);
        for (const receipt of receiptValues)
          transaction
            .objectStore("receipts")
            .delete([receipt.attemptId, receipt.commitId]);
        transaction.objectStore("packages").delete(attemptId);
        transaction.objectStore("attempts").delete(attemptId);
        transaction
          .objectStore("entitlements")
          .delete(snapshot.entitlement.entitlementId);
        if (
          !entitlementValues.some(
            (entitlement) =>
              entitlement.entitlementId !==
                snapshot.entitlement.entitlementId &&
              entitlement.installationId ===
                snapshot.entitlement.installationId,
          )
        )
          transaction
            .objectStore("installations")
            .delete(snapshot.entitlement.installationId);
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

  #storedEnvelopeAttemptId(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || !("attemptId" in value))
      return undefined;
    const parsed = internalIdSchema.safeParse(value.attemptId);
    return parsed.success ? parsed.data : undefined;
  }

  async markAttemptError(input: {
    attemptId: string;
    errorCode: OfflineScormRuntimeErrorCode;
    updatedAt: string;
    expectedSigningReservation?: OfflineScormJournalRecord;
    expectedAttemptState?: OfflineScormAttemptState;
  }): Promise<void> {
    const parsedAttemptId = internalIdSchema.parse(input.attemptId);
    const parsedErrorCode = runtimeErrorCodeSchema.parse(input.errorCode);
    const parsedUpdatedAt = canonicalInstantSchema.parse(input.updatedAt);
    try {
      const database = await this.open();
      const transaction = database.transaction(
        ["attempts", "journal"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const store = transaction.objectStore("attempts");
        const value = await requestResult<unknown>(store.get(parsedAttemptId));
        if (value === undefined)
          throw new OfflineScormRuntimeError(
            "attempt_unavailable",
            "The trusted attempt is unavailable",
          );
        const attempt = parseAttemptState(value);
        if (
          input.expectedAttemptState &&
          !sameAttemptState(input.expectedAttemptState, attempt)
        ) {
          transaction.commit();
          await completedTransaction;
          return;
        }
        if (input.expectedSigningReservation) {
          const reservationValue = await requestResult<unknown>(
            transaction
              .objectStore("journal")
              .get([
                parsedAttemptId,
                input.expectedSigningReservation.spoolEntryId,
              ]),
          );
          if (reservationValue === undefined) {
            transaction.commit();
            await completedTransaction;
            return;
          }
          const currentReservation = parseAttemptJournalRecords(
            [reservationValue],
            parsedAttemptId,
          )[0];
          if (!currentReservation || currentReservation.status !== "signing") {
            transaction.commit();
            await completedTransaction;
            return;
          }
          assertSameOfflineScormJournalReservation(
            input.expectedSigningReservation,
            currentReservation,
          );
        }
        store.put({
          ...attempt,
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

  async clearAttemptError(input: {
    attemptId: string;
    expectedErrorCode: OfflineScormRuntimeErrorCode;
    expectedUpdatedAt: string;
    updatedAt: string;
  }): Promise<void> {
    const parsedAttemptId = internalIdSchema.parse(input.attemptId);
    const expectedErrorCode = runtimeErrorCodeSchema.parse(
      input.expectedErrorCode,
    );
    const expectedUpdatedAt = canonicalInstantSchema.parse(
      input.expectedUpdatedAt,
    );
    const parsedUpdatedAt = canonicalInstantSchema.parse(input.updatedAt);
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
        const attempt = parseAttemptState(value);
        if (
          attempt.lastErrorCode === expectedErrorCode &&
          attempt.updatedAt === expectedUpdatedAt
        )
          store.put({
            ...attempt,
            lastErrorCode: null,
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
        const [existingValue, storedPackageValues] = await Promise.all([
          requestResult<unknown>(packageStore.get(record.attemptId)),
          requestResult<unknown[]>(packageStore.getAll()),
        ]);
        const storedPackages = storedPackageValues.map((value) =>
          offlineScormPackageRecordSchema.parse(value),
        );
        assertPackageOriginAvailable(record, storedPackages);
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
          assertPackageLifecycleUpdate(existing, record);
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
      const fingerprintTransaction = database.transaction(
        ["journal", "receipts"],
        "readonly",
      );
      const [existingCandidate, candidateValue] = await Promise.all([
        requestResult<unknown>(
          fingerprintTransaction
            .objectStore("receipts")
            .get([receipt.attemptId, receipt.commitId]),
        ),
        requestResult<unknown>(
          fingerprintTransaction
            .objectStore("journal")
            .index("byCommitId")
            .get(receipt.commitId),
        ),
      ]);
      await transactionComplete(fingerprintTransaction);
      if (existingCandidate !== undefined) {
        const existing = offlineScormReceiptSchema.parse(existingCandidate);
        if (JSON.stringify(existing) !== JSON.stringify(receipt))
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The reconciliation receipt cannot be replaced",
          );
      }
      if (candidateValue === undefined)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The reconciliation receipt journal record is unavailable",
        );
      const candidateRecord = parseAttemptJournalRecords(
        [candidateValue],
        receipt.attemptId,
      )[0];
      if (!candidateRecord || candidateRecord.status === "signing")
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The reconciliation receipt journal record is not signed",
        );
      const candidateCanonical = canonicalizeOfflineScormCommit(
        candidateRecord.unsignedCommit,
      );
      const candidateSignature = candidateRecord.signature;
      const requestFingerprint = await fingerprintOfflineScormCommit(
        candidateRecord.unsignedCommit,
      );
      if (requestFingerprint !== receipt.requestFingerprint)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The reconciliation receipt fingerprint does not match its journal record",
        );
      const installation = await this.getInstallation(
        candidateRecord.installationId,
      );
      if (!installation)
        throw new OfflineScormRuntimeError(
          "device_key_unavailable",
          "The reconciliation receipt device key is unavailable",
        );
      await verifyOfflineScormJournalRecord(
        candidateRecord,
        installation,
        globalThis.crypto,
      );

      const transaction = database.transaction(
        ["entitlements", "journal", "receipts"],
        "readwrite",
      );
      const completedTransaction = transactionComplete(transaction);
      try {
        const entitlementValue = await requestResult<unknown>(
          transaction.objectStore("entitlements").get(receipt.entitlementId),
        );
        if (entitlementValue === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The reconciliation receipt entitlement is unavailable",
          );
        const entitlement =
          offlineScormTrustedEntitlementSchema.parse(entitlementValue);
        if (
          entitlement.installationId !== installation.installationId ||
          entitlement.learnerId !== installation.learnerId ||
          entitlement.devicePublicKeySha256 !== installation.publicKeySha256
        )
          throw new OfflineScormRuntimeError(
            "device_key_unavailable",
            "The reconciliation receipt device key no longer matches its entitlement",
          );
        const journalValue = await requestResult<unknown>(
          transaction
            .objectStore("journal")
            .index("byCommitId")
            .get(receipt.commitId),
        );
        if (journalValue === undefined)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The reconciliation receipt journal record is unavailable",
          );
        const record = parseAttemptJournalRecords(
          [journalValue],
          receipt.attemptId,
          entitlement,
        )[0];
        if (record?.status === "discarded")
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "A discarded journal record cannot accept a later receipt",
          );
        if (
          !record ||
          record.signature !== candidateSignature ||
          canonicalizeOfflineScormCommit(record.unsignedCommit) !==
            candidateCanonical
        )
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The reconciliation receipt journal record changed during validation",
          );
        assertReceiptJournalBinding({
          receipt,
          record,
          entitlement,
          requestFingerprint,
        });
        const receiptStore = transaction.objectStore("receipts");
        const [existingValue, storedReceiptValues] = await Promise.all([
          requestResult<unknown>(
            receiptStore.get([receipt.attemptId, receipt.commitId]),
          ),
          requestResult<unknown[]>(
            receiptStore
              .index("byAttemptSequence")
              .getAll(
                this.#keyRange.bound(
                  [receipt.attemptId, 1],
                  [receipt.attemptId, MAXIMUM_SEQUENCE],
                ),
              ),
          ),
        ]);
        const storedReceipts = storedReceiptValues.map((value) =>
          offlineScormReceiptSchema.parse(value),
        );
        if (existingValue !== undefined) {
          const existing = offlineScormReceiptSchema.parse(existingValue);
          if (JSON.stringify(existing) !== JSON.stringify(receipt))
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "The reconciliation receipt cannot be replaced",
            );
        }
        assertReceiptHistory({ receipt, storedReceipts, entitlement });
        if (existingValue === undefined) {
          if (record.status === "acknowledged")
            throw new OfflineScormRuntimeError(
              "journal_corrupt",
              "An acknowledged journal record is missing its receipt",
            );
          receiptStore.add(receipt);
        }
        if (record.status !== "acknowledged")
          transaction.objectStore("journal").put({
            ...record,
            status: "acknowledged",
          } satisfies OfflineScormJournalRecord);
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
