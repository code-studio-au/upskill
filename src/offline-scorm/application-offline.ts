import {
  deleteOfflineScormCourseIndexRecord,
  listOfflineScormCourseIndexRecords,
  offlineScormCourseIndexKey,
  offlineScormCourseIndexLearnerId,
  putOfflineScormCourseIndexRecord,
  type OfflineScormCourseIndexManagedRecord,
  type OfflineScormCourseIndexRecord,
} from "#/features/scorm/offline-scorm-course-index";
import "./application-offline.css";

const PROTOCOL_VERSION = 1;

interface Bootstrap {
  schemaVersion: 1;
  learner: { id: string; name: string };
  learningRuntimeUrl: string;
}

interface Activation {
  status: "ready-to-download";
  learner: { id: string; name: string };
  envelope: {
    entitlement: {
      attemptId: string;
      entitlementId: string;
      intendedLaunchExpiresAt: string;
    };
  };
  packageManifest: { packageOrigin: string };
  trustedSigningKey: unknown;
}

interface DownloadTarget {
  courseVersionItemId: string;
  enrollmentId: string;
  key: string;
  modulePosition: number;
  title: string;
}

interface Operation {
  activation?: Activation;
  bootstrap?: Bootstrap;
  bound: boolean;
  contextReady: boolean;
  kind: "install" | "launch" | "remove" | "sync";
  learningReady: boolean;
  packageReady: boolean;
  record?: OfflineScormCourseIndexManagedRecord;
  reject(error: unknown): void;
  resolve(): void;
  target?: DownloadTarget;
}

interface DeferredInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function element<ElementType extends HTMLElement>(
  id: string,
  constructor: { new (): ElementType },
): ElementType {
  const value = document.querySelector(`#${id}`);
  if (!(value instanceof constructor))
    throw new Error(`Offline application element ${id} is missing`);
  return value;
}

const status = element("offline-status", HTMLElement);
const courseList = element("offline-courses", HTMLElement);
const downloadPanel = element("offline-download", HTMLElement);
const downloadTitle = element("offline-download-title", HTMLElement);
const downloadButton = element("offline-download-button", HTMLButtonElement);
const player = element("offline-player", HTMLElement);
const playerTitle = element("offline-player-title", HTMLElement);
const learningFrame = element("offline-learning-frame", HTMLIFrameElement);
const packageFrame = element("offline-package-frame", HTMLIFrameElement);
let active: Operation | undefined;
let deferredInstallPrompt: DeferredInstallPrompt | undefined;
let synchronizingAll = false;
let visibleLearnerId: string | undefined;

class BootstrapResponseError extends Error {}

function setStatus(message: string): void {
  status.textContent = message;
}

function installedApplication(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function supportedMobileRuntime(): boolean {
  return (
    window.matchMedia("(hover: none) and (pointer: coarse)").matches &&
    /Android/u.test(navigator.userAgent) &&
    /(?:Chrome|Chromium|Edg|Firefox)/u.test(navigator.userAgent) &&
    "serviceWorker" in navigator &&
    "caches" in window &&
    "indexedDB" in window &&
    "locks" in navigator &&
    Boolean(globalThis.crypto.subtle)
  );
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? "The offline learning request failed");
  return body;
}

async function bootstrap(): Promise<Bootstrap> {
  const response = await fetch("/api/scorm/offline/bootstrap", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = "The signed-in learner could not be verified";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // A reachable but malformed response must not expose another learner's
      // retained offline projection.
    }
    throw new BootstrapResponseError(message);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BootstrapResponseError(
      "The signed-in learner response could not be verified",
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("schemaVersion" in body) ||
    body.schemaVersion !== 1 ||
    !("learner" in body) ||
    !body.learner ||
    typeof body.learner !== "object" ||
    !("id" in body.learner) ||
    typeof body.learner.id !== "string" ||
    !("name" in body.learner) ||
    typeof body.learner.name !== "string" ||
    !("learningRuntimeUrl" in body) ||
    typeof body.learningRuntimeUrl !== "string"
  )
    throw new BootstrapResponseError(
      "The signed-in learner response could not be verified",
    );
  return body as Bootstrap;
}

function downloadTarget(): DownloadTarget | undefined {
  const parameters = new URL(location.href).searchParams;
  const enrollmentId = parameters.get("enrollmentId") ?? "";
  const courseVersionItemId = parameters.get("courseVersionItemId") ?? "";
  const title = parameters.get("title") ?? "";
  const modulePosition = Number(parameters.get("modulePosition"));
  if (
    !/^[A-Za-z0-9_-]{1,255}$/u.test(enrollmentId) ||
    !/^[A-Za-z0-9_-]{1,255}$/u.test(courseVersionItemId) ||
    title.length < 1 ||
    title.length > 200 ||
    !Number.isSafeInteger(modulePosition) ||
    modulePosition < 0
  )
    return undefined;
  return {
    courseVersionItemId,
    enrollmentId,
    key: offlineScormCourseIndexKey(enrollmentId, courseVersionItemId),
    modulePosition,
    title,
  };
}

function recordDownloadTarget(
  record: OfflineScormCourseIndexRecord,
): DownloadTarget {
  return {
    courseVersionItemId: record.courseVersionItemId,
    enrollmentId: record.enrollmentId,
    key: record.key,
    modulePosition: record.modulePosition,
    title: record.title,
  };
}

function finishOperation(error?: unknown): void {
  const current = active;
  active = undefined;
  learningFrame.removeAttribute("src");
  packageFrame.removeAttribute("src");
  player.hidden = true;
  downloadButton.disabled = false;
  if (!current) return;
  if (error === undefined) current.resolve();
  else current.reject(error);
}

function bindIfReady(): void {
  const current = active;
  const learning = learningFrame.contentWindow;
  const packageWindow = packageFrame.contentWindow;
  if (
    !current ||
    current.bound ||
    !current.learningReady ||
    !current.packageReady ||
    !current.contextReady ||
    !learning ||
    !packageWindow
  )
    return;
  const packageOrigin =
    current.activation?.packageManifest.packageOrigin ??
    current.record?.packageOrigin;
  const learningRuntimeUrl =
    current.bootstrap?.learningRuntimeUrl ?? current.record?.learningRuntimeUrl;
  if (!packageOrigin || !learningRuntimeUrl) return;
  const channel = new MessageChannel();
  const message = {
    type: "offline-scorm-sibling-channel",
    protocolVersion: PROTOCOL_VERSION,
  };
  learning.postMessage(message, new URL(learningRuntimeUrl).origin, [
    channel.port1,
  ]);
  packageWindow.postMessage(message, packageOrigin, [channel.port2]);
  current.bound = true;
}

function startOperation(
  operation: Omit<Operation, "reject" | "resolve">,
): Promise<void> {
  if (active)
    return Promise.reject(new Error("Another offline task is active"));
  return new Promise((resolve, reject) => {
    active = { ...operation, reject, resolve };
    const learningRuntimeUrl =
      operation.bootstrap?.learningRuntimeUrl ??
      operation.record?.learningRuntimeUrl;
    if (!learningRuntimeUrl) {
      finishOperation(new Error("The trusted offline runtime is unavailable"));
      return;
    }
    if (operation.kind === "launch") {
      player.hidden = false;
      playerTitle.textContent = operation.record?.title ?? "Offline course";
    }
    learningFrame.src = learningRuntimeUrl;
    if (operation.record)
      packageFrame.src = `${operation.record.packageOrigin}/.__upskill_offline__/host.html`;
  });
}

async function beginInstall(target: DownloadTarget): Promise<void> {
  if (!supportedMobileRuntime())
    throw new Error("Offline learning is supported in the Android app.");
  if (!installedApplication()) {
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      throw new Error(
        choice.outcome === "accepted"
          ? "Open the installed Upskill app to download this module."
          : "Install Upskill to learn offline.",
      );
    }
    throw new Error("Install Upskill, then reopen this course in the app.");
  }
  downloadButton.disabled = true;
  setStatus("Preparing secure offline storage…");
  await Promise.all([
    navigator.storage.persist(),
    navigator.serviceWorker.ready,
  ]);
  const runtimeBootstrap = await bootstrap();
  const records = await listOfflineScormCourseIndexRecords();
  const storedLearnerId = offlineScormCourseIndexLearnerId(records);
  if (storedLearnerId && storedLearnerId !== runtimeBootstrap.learner.id)
    throw new Error(
      "Another learner has offline courses on this device. They must remove them before accounts can be changed.",
    );
  const existing = records.find((record) => record.key === target.key);
  if (existing?.learnerId !== undefined) {
    if (existing.learnerId !== runtimeBootstrap.learner.id)
      throw new Error("This offline download belongs to another learner.");
    if (existing.state === "ready")
      throw new Error("This module is already downloaded.");
    if (existing.state === "blocked")
      throw new Error("Resolve and remove this download before retrying.");
  }
  if (!existing || existing.state === "activating")
    await putOfflineScormCourseIndexRecord({
      schemaVersion: 1,
      state: "activating",
      ...target,
      learnerId: runtimeBootstrap.learner.id,
      learnerName: runtimeBootstrap.learner.name,
      learningRuntimeUrl: runtimeBootstrap.learningRuntimeUrl,
      updatedAt: new Date().toISOString(),
    });
  visibleLearnerId = runtimeBootstrap.learner.id;
  await startOperation({
    kind: "install",
    bootstrap: runtimeBootstrap,
    target,
    bound: false,
    contextReady: false,
    learningReady: false,
    packageReady: false,
  });
}

async function beginExistingOperation(
  kind: "launch" | "remove" | "sync",
  record: OfflineScormCourseIndexManagedRecord,
): Promise<void> {
  if (!visibleLearnerId || record.learnerId !== visibleLearnerId)
    throw new Error("This offline course is not available to this learner.");
  if (kind !== "remove" && record.state !== "ready")
    throw new Error(
      "This offline course must be removed before it can reopen.",
    );
  if (kind !== "launch" && !navigator.onLine)
    throw new Error("Reconnect before synchronizing or removing a download.");
  if (
    kind === "launch" &&
    Date.now() >= Date.parse(record.intendedLaunchExpiresAt)
  )
    throw new Error("This offline access period has ended.");
  setStatus(kind === "launch" ? "Opening offline module…" : "Syncing…");
  await startOperation({
    kind,
    record,
    bound: false,
    contextReady: false,
    learningReady: false,
    packageReady: false,
  });
}

async function refreshCourses(): Promise<OfflineScormCourseIndexRecord[]> {
  const allRecords = await listOfflineScormCourseIndexRecords();
  const storedLearnerId = offlineScormCourseIndexLearnerId(allRecords);
  let authenticated = false;
  try {
    const runtimeBootstrap = await bootstrap();
    visibleLearnerId = runtimeBootstrap.learner.id;
    authenticated = true;
  } catch (error) {
    if (error instanceof BootstrapResponseError) visibleLearnerId = undefined;
    else visibleLearnerId = storedLearnerId;
  }
  const records = visibleLearnerId
    ? allRecords.filter((record) => record.learnerId === visibleLearnerId)
    : [];
  courseList.replaceChildren();
  for (const record of records) {
    const card = document.createElement("section");
    card.className = "course";
    const name = document.createElement("strong");
    name.textContent = record.title;
    const actions = document.createElement("div");
    actions.className = "course-actions";
    if (record.state === "activating" || record.state === "downloading") {
      const resume = document.createElement("button");
      resume.type = "button";
      resume.disabled = !navigator.onLine;
      resume.textContent =
        record.state === "activating" ? "Retry download" : "Resume download";
      resume.addEventListener("click", () => {
        void beginInstall(recordDownloadTarget(record)).catch(
          (error: unknown) => {
            setStatus(
              error instanceof Error ? error.message : "Download failed.",
            );
          },
        );
      });
      actions.append(resume);
      card.append(name, actions);
      courseList.append(card);
      continue;
    }
    if (record.state === "blocked") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.disabled = !navigator.onLine;
      remove.textContent = "Resolve and remove";
      remove.addEventListener("click", () => {
        void beginExistingOperation("remove", record).catch(
          (error: unknown) => {
            setStatus(
              error instanceof Error ? error.message : "Removal failed.",
            );
          },
        );
      });
      actions.append(remove);
      card.append(name, actions);
      courseList.append(card);
      continue;
    }
    const expired = Date.now() >= Date.parse(record.intendedLaunchExpiresAt);
    const open = document.createElement("button");
    open.type = "button";
    open.disabled = expired;
    open.textContent = expired ? "Access ended" : "Open offline";
    open.addEventListener("click", () => {
      void beginExistingOperation("launch", record).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Launch failed.");
      });
    });
    const sync = document.createElement("button");
    sync.type = "button";
    sync.disabled = !navigator.onLine;
    sync.textContent = "Sync now";
    sync.addEventListener("click", () => {
      void beginExistingOperation("sync", record).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Sync failed.");
      });
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.disabled = !navigator.onLine;
    remove.textContent = "Remove download";
    remove.addEventListener("click", () => {
      void beginExistingOperation("remove", record).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Removal failed.");
      });
    });
    actions.append(open, sync, remove);
    card.append(name, actions);
    courseList.append(card);
  }
  if (target) {
    const existing = records.find((record) => record.key === target.key);
    downloadButton.disabled =
      existing?.state === "ready" ||
      existing?.state === "blocked" ||
      Boolean(active);
    downloadButton.textContent =
      existing?.state === "ready"
        ? "Already downloaded"
        : existing?.state === "blocked"
          ? "Removal required"
          : existing
            ? "Resume download"
            : supportedMobileRuntime()
              ? "Download for offline"
              : "Offline on Android";
  }
  if (!active)
    setStatus(
      authenticated &&
        allRecords.some((record) => record.learnerId !== visibleLearnerId)
        ? "Offline courses on this device belong to another learner. Sign in as that learner to remove them."
        : records.length
          ? "Ready on this device"
          : authenticated || allRecords.length === 0
            ? "No offline courses are stored on this device."
            : "Sign in to manage offline courses on this device.",
    );
  return records;
}

async function handleLearningMessage(
  message: Record<string, unknown>,
): Promise<void> {
  const current = active;
  if (!current) return;
  const learningRuntimeUrl =
    current.bootstrap?.learningRuntimeUrl ?? current.record?.learningRuntimeUrl;
  if (!learningRuntimeUrl) return;
  const learningOrigin = new URL(learningRuntimeUrl).origin;
  if (
    message.type === "offline-scorm-sibling-ready" &&
    message.role === "learning"
  ) {
    current.learningReady = true;
    if (current.kind === "install" && current.bootstrap)
      learningFrame.contentWindow?.postMessage(
        {
          type: "offline-scorm-prepare-installation",
          protocolVersion: PROTOCOL_VERSION,
          learnerId: current.bootstrap.learner.id,
        },
        learningOrigin,
      );
    else if (current.record)
      learningFrame.contentWindow?.postMessage(
        {
          type: "offline-scorm-load-context",
          protocolVersion: PROTOCOL_VERSION,
          attemptId: current.record.attemptId,
          learnerName: current.record.learnerName,
          mode:
            current.kind === "launch"
              ? "launch"
              : current.kind === "remove"
                ? "remove"
                : "sync",
          packageOrigin: current.record.packageOrigin,
        },
        learningOrigin,
      );
  } else if (
    message.type === "offline-scorm-installation-ready" &&
    current.kind === "install" &&
    current.target &&
    current.bootstrap
  ) {
    const activation = await jsonResponse<Activation>(
      await fetch("/api/scorm/offline/activate", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          registration: message.registration,
          enrollmentId: current.target.enrollmentId,
          modulePosition: current.target.modulePosition,
        }),
      }),
    );
    current.activation = activation;
    const entitlement = activation.envelope.entitlement;
    await putOfflineScormCourseIndexRecord({
      schemaVersion: 1,
      state: "downloading",
      key: current.target.key,
      enrollmentId: current.target.enrollmentId,
      courseVersionItemId: current.target.courseVersionItemId,
      modulePosition: current.target.modulePosition,
      title: current.target.title,
      attemptId: entitlement.attemptId,
      entitlementId: entitlement.entitlementId,
      learnerId: activation.learner.id,
      learnerName: activation.learner.name,
      learningRuntimeUrl: current.bootstrap.learningRuntimeUrl,
      packageOrigin: activation.packageManifest.packageOrigin,
      intendedLaunchExpiresAt: entitlement.intendedLaunchExpiresAt,
      updatedAt: new Date().toISOString(),
    });
    packageFrame.src = `${activation.packageManifest.packageOrigin}/.__upskill_offline__/host.html`;
    learningFrame.contentWindow?.postMessage(
      {
        type: "offline-scorm-store-activation",
        protocolVersion: PROTOCOL_VERSION,
        activation,
      },
      learningOrigin,
    );
  } else if (
    message.type === "offline-scorm-entitlement-stored" &&
    current.kind === "install"
  ) {
    current.contextReady = true;
    bindIfReady();
  } else if (message.type === "offline-scorm-context-ready") {
    current.contextReady = true;
    bindIfReady();
  } else if (
    message.type === "offline-scorm-download-complete" &&
    current.kind === "install" &&
    current.activation &&
    current.bootstrap &&
    current.target
  ) {
    const entitlement = current.activation.envelope.entitlement;
    await putOfflineScormCourseIndexRecord({
      schemaVersion: 1,
      state: "ready",
      key: current.target.key,
      enrollmentId: current.target.enrollmentId,
      courseVersionItemId: current.target.courseVersionItemId,
      modulePosition: current.target.modulePosition,
      title: current.target.title,
      attemptId: entitlement.attemptId,
      entitlementId: entitlement.entitlementId,
      learnerId: current.activation.learner.id,
      learnerName: current.activation.learner.name,
      learningRuntimeUrl: current.bootstrap.learningRuntimeUrl,
      packageOrigin: current.activation.packageManifest.packageOrigin,
      intendedLaunchExpiresAt: entitlement.intendedLaunchExpiresAt,
      updatedAt: new Date().toISOString(),
    });
    setStatus("Ready offline");
    finishOperation();
    await refreshCourses();
  } else if (message.type === "offline-scorm-sync-batch") {
    const result = await jsonResponse<unknown>(
      await fetch("/api/scorm/offline/sync", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, batch: message.batch }),
      }),
    );
    learningFrame.contentWindow?.postMessage(
      {
        type: "offline-scorm-sync-result",
        protocolVersion: PROTOCOL_VERSION,
        result,
      },
      learningOrigin,
    );
  } else if (message.type === "offline-scorm-sync-blocked") {
    if (current.record) {
      const blockedRecord = {
        ...current.record,
        state: "blocked" as const,
        updatedAt: new Date().toISOString(),
      };
      await putOfflineScormCourseIndexRecord(blockedRecord);
      current.record = blockedRecord;
    }
    if (
      current.kind === "remove" &&
      confirm(
        "Some offline progress was rejected or conflicted and cannot be synchronized. Delete that progress and continue removing this download?",
      )
    ) {
      learningFrame.contentWindow?.postMessage(
        {
          type: "offline-scorm-discard-terminal-journal",
          protocolVersion: PROTOCOL_VERSION,
        },
        learningOrigin,
      );
      return;
    }
    setStatus(
      current.kind === "remove"
        ? "Offline progress requires attention before it can be removed."
        : "Offline progress was rejected or conflicted. Remove the download to resolve it.",
    );
    finishOperation(new Error("Offline progress synchronization is blocked"));
  } else if (message.type === "offline-scorm-sync-complete") {
    if (current.kind === "sync") {
      setStatus(
        message.locallyCompleted ? "Completed and synced" : "Progress synced",
      );
      finishOperation();
    } else if (current.kind === "remove" && current.record) {
      const resolution = await jsonResponse<Record<string, unknown>>(
        await fetch("/api/scorm/offline/resolve", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            entitlementId: current.record.entitlementId,
            resolution:
              message.resolution === "discarded" ? "discarded" : "reconciled",
          }),
        }),
      );
      learningFrame.contentWindow?.postMessage(
        {
          type: "offline-scorm-cleanup-start",
          protocolVersion: PROTOCOL_VERSION,
          ...resolution,
        },
        learningOrigin,
      );
    }
  } else if (
    message.type === "offline-scorm-cleanup-complete" &&
    current.kind === "remove"
  ) {
    await jsonResponse(
      await fetch("/api/scorm/offline/cleanup", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          entitlementId: message.entitlementId,
          cleanupReceiptSha256: message.cleanupReceiptSha256,
        }),
      }),
    );
    learningFrame.contentWindow?.postMessage(
      {
        type: "offline-scorm-cleanup-confirmed",
        protocolVersion: PROTOCOL_VERSION,
      },
      learningOrigin,
    );
  } else if (
    message.type === "offline-scorm-local-cleanup-complete" &&
    current.kind === "remove" &&
    current.record
  ) {
    await deleteOfflineScormCourseIndexRecord(current.record.key);
    setStatus("Offline download removed");
    finishOperation();
    await refreshCourses();
  } else if (message.type === "offline-scorm-runtime-error")
    throw new Error(String(message.message));
}

window.addEventListener("message", (event) => {
  const current = active;
  if (!current || !event.data || typeof event.data !== "object") return;
  const message = event.data as Record<string, unknown>;
  if (message.protocolVersion !== PROTOCOL_VERSION) return;
  const learningRuntimeUrl =
    current.bootstrap?.learningRuntimeUrl ?? current.record?.learningRuntimeUrl;
  const packageOrigin =
    current.activation?.packageManifest.packageOrigin ??
    current.record?.packageOrigin;
  if (
    learningRuntimeUrl &&
    event.source === learningFrame.contentWindow &&
    event.origin === new URL(learningRuntimeUrl).origin
  )
    void handleLearningMessage(message).catch((error: unknown) => {
      setStatus(
        error instanceof Error ? error.message : "Offline learning failed.",
      );
      finishOperation(error);
    });
  else if (
    packageOrigin &&
    event.source === packageFrame.contentWindow &&
    event.origin === packageOrigin
  ) {
    if (
      message.type === "offline-scorm-sibling-ready" &&
      message.role === "package"
    ) {
      current.packageReady = true;
      bindIfReady();
    } else if (message.type === "offline-scorm-package-busy") {
      setStatus("This module is already open on this device.");
      finishOperation(new Error("The offline package is already open"));
    } else if (message.type === "offline-scorm-package-error") {
      setStatus("The offline package needs attention.");
      finishOperation(new Error("The offline package needs attention"));
    }
  }
});

async function syncAll(): Promise<void> {
  if (synchronizingAll || active || !navigator.onLine) return;
  synchronizingAll = true;
  try {
    const records = await refreshCourses();
    for (const record of records)
      if (record.state === "ready" && record.learnerId === visibleLearnerId)
        await beginExistingOperation("sync", record);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Sync needs attention.");
  } finally {
    synchronizingAll = false;
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as DeferredInstallPrompt;
});
window.addEventListener("online", () => {
  void syncAll();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncAll();
});
element("offline-player-close", HTMLButtonElement).addEventListener(
  "click",
  () => {
    finishOperation();
  },
);

const target = downloadTarget();
if (target) {
  downloadPanel.hidden = false;
  downloadTitle.textContent = target.title;
  downloadButton.textContent = supportedMobileRuntime()
    ? "Download for offline"
    : "Offline on Android";
  downloadButton.addEventListener("click", () => {
    void beginInstall(target).catch((error: unknown) => {
      downloadButton.disabled = false;
      setStatus(
        error instanceof Error ? error.message : "Offline setup failed.",
      );
    });
  });
}

void refreshCourses()
  .then(() => syncAll())
  .catch(() => {
    setStatus("Offline course storage needs attention.");
  });
