import {
  offlineScormCourseActivationSuccessSchema,
  type OfflineScormCourseActivationSuccess,
} from "#/features/scorm/offline-scorm-activation";
import { verifyOfflineScormEntitlementEnvelope } from "#/features/scorm/offline-scorm-entitlement";
import { createOfflineScormInstallationRegistration } from "#/features/scorm/offline-scorm-installation";
import { OfflineScormIndexedDbStore } from "#/features/scorm/offline-scorm-indexeddb";
import {
  OfflineScormTrustedRuntime,
  createOfflineScormDeviceKeyRecord,
  offlineScormReceiptSchema,
} from "#/features/scorm/offline-scorm-trusted-runtime";

const PROTOCOL_VERSION = 1;
const parentOrigin = document.referrer
  ? new URL(document.referrer).origin
  : undefined;
const store = new OfflineScormIndexedDbStore();
const runtime = new OfflineScormTrustedRuntime(store);
const learningWorkerReady = navigator.serviceWorker
  .register("/api/scorm/offline-runtime/learning-worker.js", {
    scope: "/api/scorm/offline-runtime/",
    updateViaCache: "none",
  })
  .then(() => navigator.serviceWorker.ready);
let port: MessagePort | undefined;
let context:
  | {
      mode: "install" | "launch" | "remove" | "sync";
      attemptId: string;
      learnerName: string;
      packageOrigin: string;
      activation?: OfflineScormCourseActivationSuccess;
    }
  | undefined;

function postParent(message: Record<string, unknown>): void {
  if (!parentOrigin) return;
  parent.postMessage(
    { ...message, protocolVersion: PROTOCOL_VERSION },
    parentOrigin,
  );
}

function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function packageUpdatedAtAfter(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

async function prepareInstallation(learnerId: string): Promise<void> {
  await learningWorkerReady;
  let installation = await store.findInstallationForLearner(learnerId);
  if (!installation) {
    installation = await createOfflineScormDeviceKeyRecord(
      `installation_${crypto.randomUUID().replaceAll("-", "")}`,
      { learnerId },
    );
    await store.putInstallation(installation);
  }
  postParent({
    type: "offline-scorm-installation-ready",
    registration: createOfflineScormInstallationRegistration(installation),
  });
}

async function installActivation(input: unknown): Promise<void> {
  const activation = offlineScormCourseActivationSuccessSchema.parse(input);
  const trustedKey = activation.trustedSigningKey;
  const entitlement = await verifyOfflineScormEntitlementEnvelope(
    activation.envelope,
    (signingKeyId) =>
      signingKeyId === trustedKey.signingKeyId
        ? bytesFromBase64Url(trustedKey.publicKeySpki)
        : undefined,
  );
  if (!entitlement)
    throw new Error("The offline entitlement signature is invalid");
  if (
    entitlement.learnerId !== activation.learner.id ||
    entitlement.packageVersionId !==
      activation.packageManifest.packageVersionId ||
    entitlement.packageSha256 !== activation.packageManifest.packageSha256 ||
    activation.packageManifest.packageOrigin !==
      new URL(activation.packageManifest.packageOrigin).origin
  )
    throw new Error("The offline activation bindings do not match");
  const installation = await store.getInstallation(entitlement.installationId);
  if (
    !installation ||
    installation.learnerId !== entitlement.learnerId ||
    installation.publicKeySha256 !== entitlement.devicePublicKeySha256
  )
    throw new Error("The offline installation key does not match");
  await store.putEntitlement(entitlement);
  await store.putPackage({
    schemaVersion: 1,
    attemptId: entitlement.attemptId,
    entitlementId: entitlement.entitlementId,
    packageVersionId: entitlement.packageVersionId,
    packageSha256: entitlement.packageSha256,
    packageOrigin: activation.packageManifest.packageOrigin,
    drainUrl: `${activation.packageManifest.packageOrigin}/.__upskill_offline__/host.html`,
    status: "downloading",
    updatedAt: new Date().toISOString(),
  });
  context = {
    mode: "install",
    attemptId: entitlement.attemptId,
    learnerName: activation.learner.name,
    packageOrigin: activation.packageManifest.packageOrigin,
    activation,
  };
  postParent({
    type: "offline-scorm-entitlement-stored",
    attemptId: entitlement.attemptId,
  });
}

async function loadContext(input: {
  attemptId: string;
  learnerName: string;
  mode: "launch" | "remove" | "sync";
  packageOrigin: string;
}): Promise<void> {
  const [packageRecord, snapshot] = await Promise.all([
    store.getPackage(input.attemptId),
    store.getAttemptJournalSnapshot(input.attemptId),
  ]);
  if (
    !packageRecord ||
    (input.mode === "remove"
      ? packageRecord.status !== "ready" &&
        packageRecord.status !== "cleanup_pending" &&
        packageRecord.status !== "cleared"
      : packageRecord.status !== "ready") ||
    packageRecord.packageOrigin !== input.packageOrigin ||
    snapshot.entitlement.attemptId !== input.attemptId ||
    snapshot.entitlement.packageVersionId !== packageRecord.packageVersionId ||
    snapshot.entitlement.packageSha256 !== packageRecord.packageSha256 ||
    (input.mode !== "remove" &&
      snapshot.records.some((record) => record.status === "discarded"))
  )
    throw new Error("The trusted offline package binding is unavailable");
  context = input;
  postParent({
    type: "offline-scorm-context-ready",
    attemptId: input.attemptId,
  });
}

async function importSpoolEntry(entry: unknown): Promise<void> {
  if (!context || !port) throw new Error("The offline runtime is not bound");
  const acknowledgement = await runtime.importSpoolEntry({
    attemptId: context.attemptId,
    entry,
  });
  port.postMessage({
    type: "offline-scorm-import-acknowledgement",
    protocolVersion: PROTOCOL_VERSION,
    ...acknowledgement,
  });
}

async function sendSyncBatch(): Promise<void> {
  if (!context) return;
  await runtime.recoverSigningReservations(context.attemptId);
  const snapshot = await store.getAttemptJournalSnapshot(context.attemptId);
  const terminalReceipt = await store.getTerminalReceipt(context.attemptId);
  if (terminalReceipt) {
    postParent({
      type: "offline-scorm-sync-blocked",
      attemptId: context.attemptId,
      reasonCode: terminalReceipt.reasonCode,
    });
    return;
  }
  const commits = await store.listPendingSignedCommits(context.attemptId);
  if (commits.length === 0) {
    postParent({
      type: "offline-scorm-sync-complete",
      attemptId: context.attemptId,
      locallyCompleted:
        snapshot.attempt.currentSnapshot.lessonStatus === "completed" ||
        snapshot.attempt.currentSnapshot.lessonStatus === "passed",
    });
    return;
  }
  postParent({
    type: "offline-scorm-sync-batch",
    batch: {
      schemaVersion: 1,
      entitlementId: snapshot.entitlement.entitlementId,
      attemptId: context.attemptId,
      commits,
    },
  });
}

async function acceptSyncResult(input: unknown): Promise<void> {
  if (!context || !input || typeof input !== "object")
    throw new Error("The synchronization response is invalid");
  if (!("status" in input) || input.status !== "processed")
    throw new Error("Offline progress requires attention");
  if (!("receipts" in input) || !Array.isArray(input.receipts))
    throw new Error("The synchronization receipts are invalid");
  const snapshot = await store.getAttemptJournalSnapshot(context.attemptId);
  for (const receipt of input.receipts) {
    if (!receipt || typeof receipt !== "object")
      throw new Error("The synchronization receipt is invalid");
    const receiptValue = { ...(receipt as Record<string, unknown>) };
    delete receiptValue.recovered;
    await store.putReceipt(
      offlineScormReceiptSchema.parse({
        schemaVersion: 1,
        ...receiptValue,
        entitlementId: snapshot.entitlement.entitlementId,
        attemptId: context.attemptId,
      }),
    );
  }
  if (
    "block" in input &&
    input.block &&
    (typeof input.block !== "object" ||
      !("kind" in input.block) ||
      input.block.kind !== "terminal_receipt")
  )
    throw new Error("Offline progress synchronization is blocked");
  await sendSyncBatch();
}

async function discardTerminalJournal(): Promise<void> {
  if (!context) throw new Error("The offline runtime context is unavailable");
  await store.discardJournalAfterTerminalReceipt(context.attemptId);
  const snapshot = await store.getAttemptJournalSnapshot(context.attemptId);
  postParent({
    type: "offline-scorm-sync-complete",
    attemptId: context.attemptId,
    locallyCompleted:
      snapshot.attempt.currentSnapshot.lessonStatus === "completed" ||
      snapshot.attempt.currentSnapshot.lessonStatus === "passed",
    resolution: "discarded",
  });
}

async function initializePlayer(): Promise<void> {
  if (!context || !port) return;
  const snapshot = await store.getAttemptJournalSnapshot(context.attemptId);
  if (Date.now() >= Date.parse(snapshot.entitlement.intendedLaunchExpiresAt))
    throw new Error("This offline access period has ended");
  const launchSessionId = `launch_${crypto.randomUUID().replaceAll("-", "")}`;
  port.postMessage({
    type: "offline-scorm-initialize-result",
    protocolVersion: PROTOCOL_VERSION,
    learnerId: snapshot.entitlement.learnerId,
    learnerName: context.learnerName,
    launchSessionId,
    snapshot: snapshot.attempt.currentSnapshot,
  });
}

function acceptPort(nextPort: MessagePort): void {
  if (!context) throw new Error("The offline runtime context is unavailable");
  const acceptedContext = context;
  port?.close();
  port = nextPort;
  port.onmessage = (event) => {
    void (async () => {
      const message = event.data as Record<string, unknown> | undefined;
      if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
      if (message.type === "offline-scorm-spool-entry")
        await importSpoolEntry(message.entry);
      else if (message.type === "offline-scorm-spool-drained") {
        if (acceptedContext.mode === "launch") await initializePlayer();
        else await sendSyncBatch();
      } else if (message.type === "offline-scorm-package-installed") {
        const record = await store.getPackage(acceptedContext.attemptId);
        if (!record) throw new Error("The package registry is unavailable");
        await store.putPackage({
          ...record,
          status: "ready",
          updatedAt: packageUpdatedAtAfter(record.updatedAt),
        });
        postParent({
          type: "offline-scorm-download-complete",
          attemptId: acceptedContext.attemptId,
        });
      }
    })().catch((error: unknown) => {
      postParent({
        type: "offline-scorm-runtime-error",
        message:
          error instanceof Error ? error.message : "Offline runtime failed",
      });
    });
  };
  port.start();
  if (acceptedContext.mode === "install" && acceptedContext.activation)
    port.postMessage({
      type: "offline-scorm-install-package",
      protocolVersion: PROTOCOL_VERSION,
      manifest: acceptedContext.activation.packageManifest,
    });
  else
    port.postMessage({
      type: "offline-scorm-drain-request",
      protocolVersion: PROTOCOL_VERSION,
    });
}

async function beginCleanup(input: {
  cleanupCapability: string;
  entitlementId: string;
  packageSiteOrigin: string;
}): Promise<void> {
  if (!context || input.packageSiteOrigin !== context.packageOrigin)
    throw new Error("The cleanup origin does not match the trusted package");
  const record = await store.getPackage(context.attemptId);
  if (!record || record.entitlementId !== input.entitlementId)
    throw new Error("The cleanup entitlement is unavailable");
  const cleanupPendingRecord =
    record.status === "cleared"
      ? record
      : {
          ...record,
          status: "cleanup_pending" as const,
          updatedAt: packageUpdatedAtAfter(record.updatedAt),
        };
  await store.putPackage(cleanupPendingRecord);
  const cleanupUrl = new URL(
    "/.__upskill_offline__/clear-site-data",
    input.packageSiteOrigin,
  );
  cleanupUrl.searchParams.set("capability", input.cleanupCapability);
  const response = await fetch(cleanupUrl, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("The package site could not be cleared");
  const cleanupResponse = (await response.json()) as unknown;
  if (
    !cleanupResponse ||
    typeof cleanupResponse !== "object" ||
    !("cleanupReceiptSha256" in cleanupResponse) ||
    typeof cleanupResponse.cleanupReceiptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(cleanupResponse.cleanupReceiptSha256)
  )
    throw new Error("The package cleanup receipt is invalid");
  await store.putPackage({
    ...cleanupPendingRecord,
    status: "cleared",
    updatedAt: packageUpdatedAtAfter(cleanupPendingRecord.updatedAt),
  });
  postParent({
    type: "offline-scorm-cleanup-complete",
    entitlementId: input.entitlementId,
    cleanupReceiptSha256: cleanupResponse.cleanupReceiptSha256,
  });
}

window.addEventListener("message", (event) => {
  if (!parentOrigin || event.source !== parent || event.origin !== parentOrigin)
    return;
  void (async () => {
    const message = event.data as Record<string, unknown> | undefined;
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
    if (message.type === "offline-scorm-prepare-installation")
      await prepareInstallation(String(message.learnerId));
    else if (message.type === "offline-scorm-store-activation")
      await installActivation(message.activation);
    else if (message.type === "offline-scorm-load-context")
      await loadContext({
        attemptId: String(message.attemptId),
        learnerName: String(message.learnerName),
        mode:
          message.mode === "sync"
            ? "sync"
            : message.mode === "remove"
              ? "remove"
              : "launch",
        packageOrigin: new URL(String(message.packageOrigin)).origin,
      });
    else if (
      message.type === "offline-scorm-sibling-channel" &&
      event.ports.length === 1
    ) {
      const [nextPort] = event.ports;
      if (nextPort) acceptPort(nextPort);
    } else if (message.type === "offline-scorm-sync-result")
      await acceptSyncResult(message.result);
    else if (message.type === "offline-scorm-discard-terminal-journal")
      await discardTerminalJournal();
    else if (message.type === "offline-scorm-cleanup-start")
      await beginCleanup({
        cleanupCapability: String(message.cleanupCapability),
        entitlementId: String(message.entitlementId),
        packageSiteOrigin: new URL(String(message.packageSiteOrigin)).origin,
      });
    else if (message.type === "offline-scorm-cleanup-confirmed") {
      if (!context) return;
      await store.clearAcknowledgedAttempt(context.attemptId);
      postParent({
        type: "offline-scorm-local-cleanup-complete",
        attemptId: context.attemptId,
      });
    }
  })().catch((error: unknown) => {
    postParent({
      type: "offline-scorm-runtime-error",
      message:
        error instanceof Error ? error.message : "Offline runtime failed",
    });
  });
});

postParent({ type: "offline-scorm-sibling-ready", role: "learning" });
