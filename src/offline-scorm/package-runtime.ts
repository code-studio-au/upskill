import {
  OFFLINE_SCORM_PACKAGE_LOCK_NAME,
  OfflineScormPackageSpool,
  offlineScormPackageManifestSchema,
  type OfflineScormPackageManifest,
} from "#/features/scorm/offline-scorm-package-prototype";
import { scormProgressInputSchema } from "#/features/scorm/scorm.schema";

const PROTOCOL_VERSION = 1;
const parentOrigin = document.referrer
  ? new URL(document.referrer).origin
  : undefined;
const learningOrigin = document.documentElement.dataset.learningOrigin;
const spool = new OfflineScormPackageSpool(localStorage);
const content = document.querySelector<HTMLIFrameElement>("#scorm-content");
const status = document.querySelector<HTMLElement>("#scorm-status");
let port: MessagePort | undefined;
let drainingSpoolEntryId: string | undefined;
let manifest: OfflineScormPackageManifest | undefined;
let launchSessionId: string | undefined;
let initialTotalSeconds = 0;
let initialized = false;
let finished = false;
let lastError = "0";
let values: Record<string, string> = Object.create(null) as Record<
  string,
  string
>;

const errors: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "201": "Invalid argument error",
  "301": "Not initialized",
  "401": "Not implemented error",
  "403": "Element is read only",
  "405": "Incorrect data type",
};
const readOnly = new Set([
  "cmi.core.student_id",
  "cmi.core.student_name",
  "cmi.core.credit",
  "cmi.core.entry",
  "cmi.core.lesson_mode",
  "cmi.core.total_time",
]);
const lessonStatuses = new Set([
  "not attempted",
  "not_attempted",
  "incomplete",
  "completed",
  "passed",
  "failed",
  "browsed",
]);

function fail(code: string): "false" {
  lastError = code;
  return "false";
}

function succeed(): "true" {
  lastError = "0";
  return "true";
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3_600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3_600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function sessionSeconds(value: string | undefined): number | undefined {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d(?:\.\d+)?)$/u.exec(value ?? "");
  if (!match) return undefined;
  const seconds = Math.round(
    Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]),
  );
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 31_536_000
    ? seconds
    : undefined;
}

function optionalScore(name: string): number | null {
  const value = values[name];
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function progressSnapshot(sessionElapsedSeconds: number) {
  const lessonStatus =
    values["cmi.core.lesson_status"] === "not attempted"
      ? "not_attempted"
      : values["cmi.core.lesson_status"];
  return scormProgressInputSchema.parse({
    lessonStatus: lessonStatus || "incomplete",
    location: values["cmi.core.lesson_location"] ?? "",
    suspendData: values["cmi.suspend_data"] ?? "",
    scoreRaw: optionalScore("cmi.core.score.raw"),
    scoreMin: optionalScore("cmi.core.score.min"),
    scoreMax: optionalScore("cmi.core.score.max"),
    totalTimeSeconds: initialTotalSeconds + sessionElapsedSeconds,
  });
}

function drain(): void {
  if (!port || drainingSpoolEntryId) return;
  const entries = spool.listEntries();
  if (entries.length === 0) {
    port.postMessage({
      type: "offline-scorm-spool-drained",
      protocolVersion: PROTOCOL_VERSION,
    });
    return;
  }
  const [entry] = entries;
  if (!entry) return;
  drainingSpoolEntryId = entry.spoolEntryId;
  port.postMessage({
    type: "offline-scorm-spool-entry",
    protocolVersion: PROTOCOL_VERSION,
    entry,
  });
}

function checkpoint(reason: "commit" | "finish" | "pagehide"): string {
  if (!initialized || !launchSessionId) return fail("301");
  const elapsed = sessionSeconds(values["cmi.core.session_time"]);
  if (elapsed === undefined) return fail("405");
  try {
    spool.appendCheckpoint({
      spoolEntryId: `spool_${crypto.randomUUID().replaceAll("-", "")}`,
      reason,
      snapshot: progressSnapshot(elapsed),
      launchSessionId,
      sessionElapsedSeconds: elapsed,
      clientObservedAt: new Date().toISOString(),
    });
    if (status) {
      status.hidden = false;
      status.textContent = "Saving locally…";
    }
    drain();
    return succeed();
  } catch {
    if (status) {
      status.hidden = false;
      status.textContent =
        "Progress needs attention before you close this module.";
    }
    return fail("101");
  }
}

interface ScormApi {
  LMSInitialize(argument: string): string;
  LMSFinish(argument: string): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(argument: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

declare global {
  interface Window {
    API: ScormApi;
  }
}

window.API = {
  LMSInitialize(argument) {
    if (argument !== "") return fail("201");
    if (initialized || finished || !launchSessionId) return fail("101");
    initialized = true;
    return succeed();
  },
  LMSFinish(argument) {
    if (argument !== "") return fail("201");
    if (!initialized) return fail("301");
    const result = checkpoint("finish");
    if (result === "true") {
      initialized = false;
      finished = true;
    }
    return result;
  },
  LMSGetValue(element) {
    if (!initialized) {
      fail("301");
      return "";
    }
    lastError = "0";
    return values[element] ?? "";
  },
  LMSSetValue(element, value) {
    if (!initialized) return fail("301");
    if (readOnly.has(element)) return fail("403");
    if (element === "cmi.core.lesson_status" && !lessonStatuses.has(value))
      return fail("405");
    values[element] = value;
    return succeed();
  },
  LMSCommit(argument) {
    if (argument !== "") return fail("201");
    return checkpoint("commit");
  },
  LMSGetLastError: () => lastError,
  LMSGetErrorString: (code) => errors[code] ?? "Unknown error",
  LMSGetDiagnostic: (code) => errors[code || lastError] ?? "Unknown error",
};

function workerRequest(message: Record<string, unknown>): Promise<unknown> {
  return navigator.serviceWorker.ready.then((registration) => {
    const worker =
      registration.active ?? registration.waiting ?? registration.installing;
    if (!worker) throw new Error("The offline package worker is unavailable");
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const result = event.data as { status?: string };
        if (result.status === "failed")
          reject(new Error("The offline package operation failed"));
        else resolve(event.data);
      };
      worker.postMessage(message, [channel.port2]);
    });
  });
}

async function installedManifest(): Promise<OfflineScormPackageManifest> {
  const result = (await workerRequest({
    type: "offline-scorm-get-manifest",
  })) as { manifest?: unknown; status?: string };
  if (result.status !== "ready")
    throw new Error("The offline package is not installed");
  return offlineScormPackageManifestSchema.parse(result.manifest);
}

function acceptPort(nextPort: MessagePort): void {
  port?.close();
  drainingSpoolEntryId = undefined;
  port = nextPort;
  port.onmessage = (event) => {
    void (async () => {
      const message = event.data as Record<string, unknown> | undefined;
      if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
      if (message.type === "offline-scorm-install-package") {
        manifest = offlineScormPackageManifestSchema.parse(message.manifest);
        await workerRequest({
          type: "offline-scorm-install-package",
          manifest,
        });
        port?.postMessage({
          type: "offline-scorm-package-installed",
          protocolVersion: PROTOCOL_VERSION,
        });
      } else if (message.type === "offline-scorm-drain-request") {
        manifest = await installedManifest();
        drain();
      } else if (message.type === "offline-scorm-import-acknowledgement") {
        const spoolEntryId = String(message.spoolEntryId);
        if (spoolEntryId !== drainingSpoolEntryId)
          throw new Error("The spool acknowledgement is out of order");
        spool.acknowledge(spoolEntryId);
        drainingSpoolEntryId = undefined;
        drain();
      } else if (message.type === "offline-scorm-initialize-result") {
        if (!manifest) manifest = await installedManifest();
        const snapshot = scormProgressInputSchema.parse(message.snapshot);
        launchSessionId = String(message.launchSessionId);
        spool.beginLaunch(launchSessionId);
        initialTotalSeconds = snapshot.totalTimeSeconds;
        values = {
          "cmi.core.student_id": String(message.learnerId),
          "cmi.core.student_name": String(message.learnerName),
          "cmi.core.credit": "credit",
          "cmi.core.entry":
            snapshot.lessonStatus === "not_attempted" ? "ab-initio" : "resume",
          "cmi.core.lesson_mode": "normal",
          "cmi.core.lesson_location": snapshot.location,
          "cmi.core.lesson_status":
            snapshot.lessonStatus === "not_attempted"
              ? "not attempted"
              : snapshot.lessonStatus,
          "cmi.core.score.raw":
            snapshot.scoreRaw === null ? "" : String(snapshot.scoreRaw),
          "cmi.core.score.min":
            snapshot.scoreMin === null ? "" : String(snapshot.scoreMin),
          "cmi.core.score.max":
            snapshot.scoreMax === null ? "" : String(snapshot.scoreMax),
          "cmi.core.total_time": formatTime(snapshot.totalTimeSeconds),
          "cmi.core.session_time": "00:00:00",
          "cmi.suspend_data": snapshot.suspendData,
          "cmi.launch_data": "",
        };
        if (!content)
          throw new Error("The package content frame is unavailable");
        content.src = new URL(
          manifest.entrypointPath,
          manifest.packageOrigin,
        ).href;
        if (status) status.hidden = true;
      }
    })().catch(() => {
      if (status) {
        status.hidden = false;
        status.textContent = "This offline module needs attention.";
      }
      parent.postMessage(
        {
          type: "offline-scorm-package-error",
          protocolVersion: PROTOCOL_VERSION,
        },
        parentOrigin ?? "*",
      );
    });
  };
  port.start();
}

window.addEventListener("message", (event) => {
  if (!parentOrigin || event.source !== parent || event.origin !== parentOrigin)
    return;
  const message = event.data as Record<string, unknown> | undefined;
  if (
    message?.type === "offline-scorm-sibling-channel" &&
    message.protocolVersion === PROTOCOL_VERSION &&
    event.ports.length === 1
  ) {
    const [nextPort] = event.ports;
    if (nextPort) acceptPort(nextPort);
  }
});

window.addEventListener("pagehide", () => {
  if (initialized) checkpoint("pagehide");
});

void navigator.serviceWorker
  .register(
    `/.__upskill_offline__/worker.js?applicationOrigin=${encodeURIComponent(parentOrigin ?? "")}&learningOrigin=${encodeURIComponent(learningOrigin ?? "")}`,
    { scope: "/", updateViaCache: "none" },
  )
  .then(() => navigator.serviceWorker.ready)
  .then(() =>
    navigator.locks.request(
      OFFLINE_SCORM_PACKAGE_LOCK_NAME,
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (!lock) {
          parent.postMessage(
            {
              type: "offline-scorm-package-busy",
              protocolVersion: PROTOCOL_VERSION,
            },
            parentOrigin ?? "*",
          );
          return;
        }
        parent.postMessage(
          {
            type: "offline-scorm-sibling-ready",
            protocolVersion: PROTOCOL_VERSION,
            role: "package",
          },
          parentOrigin ?? "*",
        );
        await new Promise<void>(() => undefined);
      },
    ),
  )
  .catch(() => {
    if (status) status.textContent = "Offline storage could not be prepared.";
  });
