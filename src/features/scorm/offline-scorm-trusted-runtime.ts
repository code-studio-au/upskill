import {
  canonicalizeOfflineScormCommit,
  offlineScormOfferingBindingSchema,
  offlineScormSignedCommitSchema,
  offlineScormUnsignedCommitSchema,
  type OfflineScormSignedCommit,
  type OfflineScormUnsignedCommit,
} from "#/features/scorm/offline-scorm-reconciliation";
import {
  scormProgressInputSchema,
  type ScormProgressInput,
} from "#/features/scorm/scorm.schema";
import { instantIsoSchema } from "#/features/shared/time.schema";
import { z } from "#/validation/zod";

export const OFFLINE_SCORM_TRUSTED_DATABASE_VERSION = 1;
export const OFFLINE_SCORM_TRUSTED_DATABASE_NAME =
  "upskill-offline-scorm-trusted";

export const offlineScormTrustedStoreNames = [
  "installations",
  "entitlements",
  "attempts",
  "launches",
  "journal",
  "packages",
  "receipts",
] as const;

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
const sequenceSchema = z
  .number()
  .check(z.int(), z.minimum(1), z.maximum(2_147_483_647));
const canonicalInstantSchema = z.pipe(
  instantIsoSchema,
  z.transform((value) => new Date(value).toISOString()),
);
const maximumAcceptanceDelayMs = 30 * 24 * 60 * 60 * 1_000;

export const offlineScormTrustedEntitlementSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    entitlementId: internalIdSchema,
    attemptId: internalIdSchema,
    installationId: internalIdSchema,
    learnerId: internalIdSchema,
    devicePublicKeySha256: sha256Schema,
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
    initialSnapshot: scormProgressInputSchema,
    issuedAt: canonicalInstantSchema,
    intendedLaunchExpiresAt: canonicalInstantSchema,
    commitAcceptanceDeadline: canonicalInstantSchema,
  })
  .check(
    z.refine(
      (value) =>
        Date.parse(value.issuedAt) <
          Date.parse(value.intendedLaunchExpiresAt) &&
        Date.parse(value.intendedLaunchExpiresAt) <
          Date.parse(value.commitAcceptanceDeadline) &&
        Date.parse(value.commitAcceptanceDeadline) -
          Date.parse(value.intendedLaunchExpiresAt) <=
          maximumAcceptanceDelayMs,
      {
        path: ["commitAcceptanceDeadline"],
        message:
          "Offline entitlement deadlines must be ordered within the 30-day acceptance limit",
      },
    ),
  );

export const offlineScormSpoolEntrySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    spoolEntryId: randomIdSchema,
    ordinal: sequenceSchema,
    reason: z.enum(["commit", "finish", "checkpoint", "pagehide"]),
    snapshot: scormProgressInputSchema,
    launchSessionId: randomIdSchema,
    sessionElapsedSeconds: boundedSecondsSchema,
    sessionTimeDeltaSeconds: boundedSecondsSchema,
    clientObservedAt: canonicalInstantSchema,
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

export const offlineScormPackageRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    attemptId: internalIdSchema,
    entitlementId: internalIdSchema,
    packageVersionId: internalIdSchema,
    packageSha256: sha256Schema,
    packageOrigin: z.url(),
    drainUrl: z.url(),
    status: z.enum([
      "downloading",
      "ready",
      "integrity_failed",
      "cleanup_pending",
      "cleared",
    ]),
    updatedAt: canonicalInstantSchema,
  })
  .check(
    z.superRefine((value, context) => {
      const packageOrigin = new URL(value.packageOrigin);
      const drainUrl = new URL(value.drainUrl);
      const loopbackDevelopmentOrigin =
        packageOrigin.protocol === "http:" &&
        (packageOrigin.hostname === "127.0.0.1" ||
          packageOrigin.hostname === "localhost");
      if (packageOrigin.protocol !== "https:" && !loopbackDevelopmentOrigin)
        context.addIssue({
          code: "custom",
          path: ["packageOrigin"],
          message: "The package origin must use HTTPS",
        });
      if (
        packageOrigin.origin !== value.packageOrigin ||
        packageOrigin.username ||
        packageOrigin.password
      )
        context.addIssue({
          code: "custom",
          path: ["packageOrigin"],
          message: "The package origin must contain only an exact origin",
        });
      if (
        drainUrl.origin !== packageOrigin.origin ||
        drainUrl.username ||
        drainUrl.password
      )
        context.addIssue({
          code: "custom",
          path: ["drainUrl"],
          message: "The drain URL must belong to the exact package origin",
        });
    }),
  );

export const offlineScormReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entitlementId: internalIdSchema,
  attemptId: internalIdSchema,
  commitId: randomIdSchema,
  clientSequence: sequenceSchema,
  requestFingerprint: sha256Schema,
  outcome: z.enum(["accepted", "rejected", "conflict"]),
  reasonCode: z.string().check(z.minLength(1), z.maxLength(100)),
  resultingAttemptRevision: z.nullable(revisionSchema),
  receivedAt: canonicalInstantSchema,
});

export type OfflineScormTrustedEntitlement = z.infer<
  typeof offlineScormTrustedEntitlementSchema
>;
export type OfflineScormSpoolEntry = z.infer<
  typeof offlineScormSpoolEntrySchema
>;
export type OfflineScormPackageRecord = z.infer<
  typeof offlineScormPackageRecordSchema
>;
export type OfflineScormReceipt = z.infer<typeof offlineScormReceiptSchema>;

export interface OfflineScormDeviceKeyRecord {
  schemaVersion: 1;
  installationId: string;
  learnerId: string;
  privateKey: CryptoKey;
  publicKeySpki: Uint8Array<ArrayBuffer>;
  publicKeySha256: string;
  createdAt: string;
}

export interface OfflineScormAttemptState {
  schemaVersion: 1;
  attemptId: string;
  entitlementId: string;
  nextClientSequence: number;
  currentSnapshot: ScormProgressInput;
  lastErrorCode: OfflineScormRuntimeErrorCode | null;
  updatedAt: string;
}

export interface OfflineScormLaunchState {
  schemaVersion: 1;
  attemptId: string;
  launchSessionId: string;
  nextExpectedOrdinal: number;
  elapsedHighwaterSeconds: number;
  updatedAt: string;
}

type OfflineScormJournalStatus = "signing" | "pending" | "acknowledged";

export interface OfflineScormJournalRecord {
  schemaVersion: 1;
  attemptId: string;
  entitlementId: string;
  installationId: string;
  spoolEntryId: string;
  spoolFingerprint: string;
  spoolEntry: OfflineScormSpoolEntry;
  clientSequence: number;
  commitId: string;
  unsignedCommit: OfflineScormUnsignedCommit;
  status: OfflineScormJournalStatus;
  signature: string | null;
  reservedAt: string;
  finalisedAt: string | null;
}

export type OfflineScormRuntimeErrorCode =
  | "attempt_unavailable"
  | "device_key_unavailable"
  | "journal_corrupt"
  | "launch_history_invalid"
  | "signing_failed"
  | "signing_in_progress"
  | "storage_failed";

export class OfflineScormRuntimeError extends Error {
  constructor(
    public readonly code: OfflineScormRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflineScormRuntimeError";
  }
}

export interface OfflineScormImportAcknowledgement {
  attemptId: string;
  spoolEntryId: string;
  spoolFingerprint: string;
  commitId: string;
  clientSequence: number;
  status: "protected";
}

export interface OfflineScormRecoveryResult {
  acknowledgements: OfflineScormImportAcknowledgement[];
  failures: {
    attemptId: string;
    code: OfflineScormRuntimeErrorCode;
  }[];
  unattributedCorruptRecords: number;
}

export interface OfflineScormSigningReservationScan {
  reservations: OfflineScormJournalRecord[];
  corruptAttemptIds: string[];
  unattributedCorruptRecords: number;
}

export interface OfflineScormAttemptJournalSnapshot {
  attempt: OfflineScormAttemptState;
  entitlement: OfflineScormTrustedEntitlement;
  records: OfflineScormJournalRecord[];
}

export interface OfflineScormTrustedStore {
  putInstallation(record: OfflineScormDeviceKeyRecord): Promise<void>;
  getInstallation(
    installationId: string,
  ): Promise<OfflineScormDeviceKeyRecord | undefined>;
  putEntitlement(entitlement: OfflineScormTrustedEntitlement): Promise<void>;
  reserveSpoolEntry(input: {
    attemptId: string;
    entry: OfflineScormSpoolEntry;
    fingerprint: string;
    candidateCommitId: string;
    reservedAt: string;
  }): Promise<OfflineScormJournalRecord>;
  finaliseJournalEntry(input: {
    attemptId: string;
    spoolEntryId: string;
    fingerprint: string;
    signature: string;
    finalisedAt: string;
  }): Promise<OfflineScormJournalRecord>;
  listSigningReservations(
    attemptId?: string,
  ): Promise<OfflineScormSigningReservationScan>;
  getAttemptJournalSnapshot(
    attemptId: string,
  ): Promise<OfflineScormAttemptJournalSnapshot>;
  markAttemptError(
    attemptId: string,
    errorCode: OfflineScormRuntimeErrorCode,
    updatedAt: string,
  ): Promise<void>;
  putPackage(record: OfflineScormPackageRecord): Promise<void>;
  putReceipt(receipt: OfflineScormReceipt): Promise<void>;
}

export interface OfflineScormCryptoProvider {
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
  subtle: SubtleCrypto;
}

function canonicalizeSpoolEntry(entry: OfflineScormSpoolEntry): string {
  return JSON.stringify([
    "upskill-offline-scorm-spool-v1",
    entry.schemaVersion,
    entry.spoolEntryId,
    entry.ordinal,
    entry.reason,
    [
      entry.snapshot.lessonStatus,
      entry.snapshot.location,
      entry.snapshot.suspendData,
      entry.snapshot.scoreRaw,
      entry.snapshot.scoreMin,
      entry.snapshot.scoreMax,
      entry.snapshot.totalTimeSeconds,
    ],
    entry.launchSessionId,
    entry.sessionElapsedSeconds,
    entry.sessionTimeDeltaSeconds,
    entry.clientObservedAt,
  ]);
}

function canonicalizeProgressSnapshot(snapshot: ScormProgressInput): string {
  return JSON.stringify([
    snapshot.lessonStatus,
    snapshot.location,
    snapshot.suspendData,
    snapshot.scoreRaw,
    snapshot.scoreMin,
    snapshot.scoreMax,
    snapshot.totalTimeSeconds,
  ]);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet.charAt(first >> 2);
    result += alphabet.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4));
    if (second !== undefined)
      result += alphabet.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6));
    if (third !== undefined) result += alphabet.charAt(third & 0x3f);
  }
  return result;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;
  for (const character of value) {
    const decoded = alphabet.indexOf(character);
    if (decoded < 0)
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The stored journal signature is invalid",
      );
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    bytes[byteIndex] = (buffer >>> bits) & 0xff;
    byteIndex += 1;
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The stored journal signature has non-canonical padding",
    );
  return bytes;
}

export async function fingerprintOfflineScormSpoolEntry(
  input: unknown,
  cryptoProvider: OfflineScormCryptoProvider = globalThis.crypto,
): Promise<{ entry: OfflineScormSpoolEntry; fingerprint: string }> {
  const entry = offlineScormSpoolEntrySchema.parse(input);
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalizeSpoolEntry(entry)),
  );
  return { entry, fingerprint: bytesToHex(new Uint8Array(digest)) };
}

export async function createOfflineScormDeviceKeyRecord(
  installationId: string,
  options: {
    learnerId: string;
    cryptoProvider?: OfflineScormCryptoProvider;
    now?: () => Date;
  },
): Promise<OfflineScormDeviceKeyRecord> {
  const parsedInstallationId = internalIdSchema.parse(installationId);
  const learnerId = internalIdSchema.parse(options.learnerId);
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  const keyPair = await cryptoProvider.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKeySpki = new Uint8Array(
    await cryptoProvider.subtle.exportKey("spki", keyPair.publicKey),
  );
  const publicKeySha256 = bytesToHex(
    new Uint8Array(
      await cryptoProvider.subtle.digest("SHA-256", publicKeySpki),
    ),
  );
  return {
    schemaVersion: 1,
    installationId: parsedInstallationId,
    learnerId,
    privateKey: keyPair.privateKey,
    publicKeySpki,
    publicKeySha256,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

async function signOfflineScormCommit(
  commit: OfflineScormUnsignedCommit,
  deviceKey: OfflineScormDeviceKeyRecord,
  cryptoProvider: OfflineScormCryptoProvider,
): Promise<string> {
  const calculatedPublicKeySha256 = bytesToHex(
    new Uint8Array(
      await cryptoProvider.subtle.digest("SHA-256", deviceKey.publicKeySpki),
    ),
  );
  if (calculatedPublicKeySha256 !== deviceKey.publicKeySha256)
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device public key fingerprint is invalid",
    );
  const publicKey = await cryptoProvider.subtle.importKey(
    "spki",
    deviceKey.publicKeySpki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const canonical = new TextEncoder().encode(
    canonicalizeOfflineScormCommit(commit),
  );
  const signature = new Uint8Array(
    await cryptoProvider.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      deviceKey.privateKey,
      canonical,
    ),
  );
  const valid = await cryptoProvider.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    canonical,
  );
  if (!valid)
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device key pair does not match",
    );
  const encoded = bytesToBase64Url(signature);
  offlineScormSignedCommitSchema.parse({ ...commit, signature: encoded });
  return encoded;
}

async function verifyOfflineScormJournalRecord(
  record: OfflineScormJournalRecord,
  deviceKey: OfflineScormDeviceKeyRecord,
  cryptoProvider: OfflineScormCryptoProvider,
): Promise<void> {
  if (
    record.status === "signing" ||
    record.signature === null ||
    record.installationId !== deviceKey.installationId
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The finalised journal record is invalid",
    );
  let signedCommit: OfflineScormSignedCommit;
  try {
    signedCommit = parseStoredOfflineScormSignedCommit({
      unsignedCommit: record.unsignedCommit,
      signature: record.signature,
    });
  } catch (error) {
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The finalised journal record is not canonical",
      { cause: error },
    );
  }
  const calculatedPublicKeySha256 = bytesToHex(
    new Uint8Array(
      await cryptoProvider.subtle.digest("SHA-256", deviceKey.publicKeySpki),
    ),
  );
  if (calculatedPublicKeySha256 !== deviceKey.publicKeySha256)
    throw new OfflineScormRuntimeError(
      "device_key_unavailable",
      "The stored device public key fingerprint is invalid",
    );
  const publicKey = await cryptoProvider.subtle.importKey(
    "spki",
    deviceKey.publicKeySpki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await cryptoProvider.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64UrlToBytes(signedCommit.signature),
    new TextEncoder().encode(
      canonicalizeOfflineScormCommit(record.unsignedCommit),
    ),
  );
  if (!valid)
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The stored journal signature does not match its canonical commit",
    );
}

function assertSameJournalReservation(
  reservation: OfflineScormJournalRecord,
  finalised: OfflineScormJournalRecord,
): void {
  if (
    reservation.attemptId !== finalised.attemptId ||
    reservation.entitlementId !== finalised.entitlementId ||
    reservation.installationId !== finalised.installationId ||
    reservation.spoolEntryId !== finalised.spoolEntryId ||
    reservation.spoolFingerprint !== finalised.spoolFingerprint ||
    canonicalizeSpoolEntry(reservation.spoolEntry) !==
      canonicalizeSpoolEntry(finalised.spoolEntry) ||
    reservation.commitId !== finalised.commitId ||
    reservation.clientSequence !== finalised.clientSequence ||
    canonicalizeOfflineScormCommit(reservation.unsignedCommit) !==
      canonicalizeOfflineScormCommit(finalised.unsignedCommit)
  )
    throw new OfflineScormRuntimeError(
      "journal_corrupt",
      "The finalised journal record does not match its signing reservation",
    );
}

function importAcknowledgement(
  record: OfflineScormJournalRecord,
): OfflineScormImportAcknowledgement {
  if (record.status === "signing")
    throw new OfflineScormRuntimeError(
      "signing_in_progress",
      "The journal reservation has not finished signing",
    );
  return {
    attemptId: record.attemptId,
    spoolEntryId: record.spoolEntryId,
    spoolFingerprint: record.spoolFingerprint,
    commitId: record.commitId,
    clientSequence: record.clientSequence,
    status: "protected",
  };
}

export class OfflineScormTrustedRuntime {
  readonly #store: OfflineScormTrustedStore;
  readonly #cryptoProvider: OfflineScormCryptoProvider;
  readonly #now: () => Date;

  constructor(
    store: OfflineScormTrustedStore,
    options: {
      cryptoProvider?: OfflineScormCryptoProvider;
      now?: () => Date;
    } = {},
  ) {
    this.#store = store;
    this.#cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
    this.#now = options.now ?? (() => new Date());
  }

  async importSpoolEntry(input: {
    attemptId: string;
    entry: unknown;
  }): Promise<OfflineScormImportAcknowledgement> {
    const attemptId = internalIdSchema.parse(input.attemptId);
    try {
      const { entry, fingerprint } = await fingerprintOfflineScormSpoolEntry(
        input.entry,
        this.#cryptoProvider,
      );
      await this.#verifyAttemptJournal(attemptId);
      const reservation = await this.#store.reserveSpoolEntry({
        attemptId,
        entry,
        fingerprint,
        candidateCommitId: `commit_${this.#cryptoProvider.randomUUID()}`,
        reservedAt: this.#now().toISOString(),
      });
      const verifiedJournal = await this.#verifyAttemptJournal(attemptId);
      const verifiedReservation = verifiedJournal.records.find(
        (record) => record.spoolEntryId === reservation.spoolEntryId,
      );
      if (!verifiedReservation)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The journal reservation is unavailable",
        );
      assertSameJournalReservation(reservation, verifiedReservation);
      if (reservation.status !== "signing")
        return importAcknowledgement(reservation);
      return await this.#signAndFinalise(reservation);
    } catch (error) {
      const runtimeError =
        error instanceof OfflineScormRuntimeError
          ? error
          : new OfflineScormRuntimeError(
              "launch_history_invalid",
              "The package checkpoint is invalid",
              { cause: error },
            );
      await this.#recordFailure(attemptId, runtimeError);
      throw runtimeError;
    }
  }

  async recoverSigningReservations(
    attemptId?: string,
  ): Promise<OfflineScormRecoveryResult> {
    const parsedAttemptId = attemptId
      ? internalIdSchema.parse(attemptId)
      : undefined;
    const scan = await this.#store.listSigningReservations(parsedAttemptId);
    const acknowledgements: OfflineScormImportAcknowledgement[] = [];
    const failures: OfflineScormRecoveryResult["failures"] = [];
    const blockedAttempts = new Set(scan.corruptAttemptIds);
    for (const corruptAttemptId of scan.corruptAttemptIds) {
      const error = new OfflineScormRuntimeError(
        "journal_corrupt",
        "The attempt contains a corrupt signing reservation",
      );
      await this.#recordFailure(corruptAttemptId, error);
      failures.push({
        attemptId: corruptAttemptId,
        code: error.code,
      });
    }
    for (const reservation of scan.reservations) {
      if (blockedAttempts.has(reservation.attemptId)) continue;
      try {
        acknowledgements.push(await this.#signAndFinalise(reservation));
      } catch (error) {
        blockedAttempts.add(reservation.attemptId);
        failures.push({
          attemptId: reservation.attemptId,
          code:
            error instanceof OfflineScormRuntimeError
              ? error.code
              : "signing_failed",
        });
      }
    }
    return {
      acknowledgements,
      failures,
      unattributedCorruptRecords: scan.unattributedCorruptRecords,
    };
  }

  async #signAndFinalise(
    reservation: OfflineScormJournalRecord,
  ): Promise<OfflineScormImportAcknowledgement> {
    try {
      const journalBeforeSigning = await this.#verifyAttemptJournal(
        reservation.attemptId,
      );
      const storedReservation = journalBeforeSigning.records.find(
        (record) => record.spoolEntryId === reservation.spoolEntryId,
      );
      if (!storedReservation)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The signing reservation is unavailable",
        );
      assertSameJournalReservation(reservation, storedReservation);
      const signature = await signOfflineScormCommit(
        reservation.unsignedCommit,
        journalBeforeSigning.installation,
        this.#cryptoProvider,
      );
      const finalised = await this.#store.finaliseJournalEntry({
        attemptId: reservation.attemptId,
        spoolEntryId: reservation.spoolEntryId,
        fingerprint: reservation.spoolFingerprint,
        signature,
        finalisedAt: this.#now().toISOString(),
      });
      assertSameJournalReservation(reservation, finalised);
      const verifiedJournal = await this.#verifyAttemptJournal(
        reservation.attemptId,
      );
      const verifiedFinalised = verifiedJournal.records.find(
        (record) => record.spoolEntryId === reservation.spoolEntryId,
      );
      if (!verifiedFinalised)
        throw new OfflineScormRuntimeError(
          "journal_corrupt",
          "The finalised journal record is unavailable",
        );
      assertSameJournalReservation(finalised, verifiedFinalised);
      return importAcknowledgement(finalised);
    } catch (error) {
      const runtimeError =
        error instanceof OfflineScormRuntimeError
          ? error
          : new OfflineScormRuntimeError(
              "signing_failed",
              "The offline journal reservation could not be signed",
              { cause: error },
            );
      await this.#recordFailure(reservation.attemptId, runtimeError);
      throw runtimeError;
    }
  }

  async #verifyAttemptJournal(attemptId: string): Promise<{
    records: OfflineScormJournalRecord[];
    installation: OfflineScormDeviceKeyRecord;
  }> {
    const snapshot = await this.#store.getAttemptJournalSnapshot(attemptId);
    const installation = await this.#store.getInstallation(
      snapshot.entitlement.installationId,
    );
    if (!installation)
      throw new OfflineScormRuntimeError(
        "device_key_unavailable",
        "The device signing key is unavailable",
      );
    if (
      installation.learnerId !== snapshot.entitlement.learnerId ||
      installation.publicKeySha256 !==
        snapshot.entitlement.devicePublicKeySha256
    )
      throw new OfflineScormRuntimeError(
        "device_key_unavailable",
        "The device signing key no longer matches its entitlement",
      );
    let latestFinalised: OfflineScormJournalRecord | undefined;
    for (const record of snapshot.records)
      if (record.status !== "signing") latestFinalised = record;
    const expectedSnapshot =
      latestFinalised?.unsignedCommit.snapshot ??
      snapshot.entitlement.initialSnapshot;
    if (
      canonicalizeProgressSnapshot(snapshot.attempt.currentSnapshot) !==
      canonicalizeProgressSnapshot(expectedSnapshot)
    )
      throw new OfflineScormRuntimeError(
        "journal_corrupt",
        "The materialised attempt snapshot does not match signed history",
      );
    await Promise.all(
      snapshot.records.map(async (record) => {
        const { fingerprint } = await fingerprintOfflineScormSpoolEntry(
          record.spoolEntry,
          this.#cryptoProvider,
        );
        if (fingerprint !== record.spoolFingerprint)
          throw new OfflineScormRuntimeError(
            "journal_corrupt",
            "The stored journal spool fingerprint is invalid",
          );
        if (record.status === "signing") return;
        await verifyOfflineScormJournalRecord(
          record,
          installation,
          this.#cryptoProvider,
        );
      }),
    );
    return { records: snapshot.records, installation };
  }

  async #recordFailure(
    attemptId: string,
    error: OfflineScormRuntimeError,
  ): Promise<void> {
    try {
      await this.#store.markAttemptError(
        attemptId,
        error.code,
        this.#now().toISOString(),
      );
    } catch {
      // Preserve the causal import/signing failure. A storage failure while
      // recording its classification cannot make that original failure safe.
    }
  }
}

export const offlineScormLocalStatusLabels = {
  ready_offline: "Ready offline",
  saving_locally: "Saving locally",
  protected_on_device: "Progress protected on this device",
  completed_on_device: "Completed on this device",
  completed_and_synced: "Completed and synced",
  needs_attention: "Needs attention",
} as const;

export type OfflineScormLocalStatus =
  keyof typeof offlineScormLocalStatusLabels;

export function resolveOfflineScormLocalStatus(input: {
  needsAttention: boolean;
  stagedSpoolCount: number;
  pendingJournalCount: number;
  locallyCompleted: boolean;
  serverCompletionConfirmed: boolean;
}): OfflineScormLocalStatus {
  if (input.needsAttention) return "needs_attention";
  if (input.stagedSpoolCount > 0) return "saving_locally";
  if (input.serverCompletionConfirmed) return "completed_and_synced";
  if (input.locallyCompleted) return "completed_on_device";
  if (input.pendingJournalCount > 0) return "protected_on_device";
  return "ready_offline";
}

export function parseStoredOfflineScormUnsignedCommit(
  input: unknown,
): OfflineScormUnsignedCommit {
  return offlineScormUnsignedCommitSchema.parse(input);
}

export function parseStoredOfflineScormSignedCommit(input: {
  unsignedCommit: unknown;
  signature: unknown;
}): OfflineScormSignedCommit {
  return offlineScormSignedCommitSchema.parse({
    ...(typeof input.unsignedCommit === "object" && input.unsignedCommit
      ? input.unsignedCommit
      : {}),
    signature: input.signature,
  });
}
