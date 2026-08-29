export const SCORM_12_RUNTIME = `(() => {
  "use strict";
  const root = document.documentElement;
  const attemptId = root.dataset.attemptId || "";
  const base = "/api/scorm/attempts/" + encodeURIComponent(attemptId);
  const content = document.getElementById("scorm-content");
  const status = document.getElementById("scorm-status");
  let initialized = false;
  let finished = false;
  let lastError = "0";
  let initialTotalSeconds = 0;
  let values = Object.create(null);
  let saveChain = Promise.resolve();

  const errors = {
    "0": "No error",
    "101": "General exception",
    "201": "Invalid argument error",
    "301": "Not initialized",
    "401": "Not implemented error",
    "403": "Element is read only",
    "405": "Incorrect data type"
  };
  const readOnly = new Set([
    "cmi.core.student_id",
    "cmi.core.student_name",
    "cmi.core.credit",
    "cmi.core.entry",
    "cmi.core.lesson_mode",
    "cmi.core.total_time"
  ]);
  const lessonStatuses = new Set([
    "not attempted", "not_attempted", "incomplete", "completed",
    "passed", "failed", "browsed"
  ]);

  function fail(code) {
    lastError = code;
    return "false";
  }

  function succeed() {
    lastError = "0";
    return "true";
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    return hours + ":" + minutes + ":" + remainder;
  }

  function sessionSeconds(value) {
    const match = /^(\\d{2,}):([0-5]\\d):([0-5]\\d(?:\\.\\d+)?)$/.exec(value || "");
    if (!match) return 0;
    return Math.round(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }

  function optionalScore(name) {
    const value = values[name];
    if (value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function progressPayload() {
    const lessonStatus = values["cmi.core.lesson_status"] === "not attempted"
      ? "not_attempted"
      : values["cmi.core.lesson_status"];
    return {
      lessonStatus: lessonStatus || "incomplete",
      location: values["cmi.core.lesson_location"] || "",
      suspendData: values["cmi.suspend_data"] || "",
      scoreRaw: optionalScore("cmi.core.score.raw"),
      scoreMin: optionalScore("cmi.core.score.min"),
      scoreMax: optionalScore("cmi.core.score.max"),
      totalTimeSeconds: initialTotalSeconds + sessionSeconds(values["cmi.core.session_time"])
    };
  }

  function persist(useBeacon, finish) {
    if (!initialized) return;
    const body = JSON.stringify(progressPayload());
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(base, new Blob([body], { type: "application/json" }));
      return;
    }
    saveChain = saveChain.then(() => fetch(base, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body
    }).then((response) => {
      if (!response.ok) throw new Error("SCORM progress was not accepted");
      if (finish) window.location.replace(base + "?view=progress-saved");
    })).catch(() => {
      lastError = "101";
    });
  }

  window.API = {
    LMSInitialize(argument) {
      if (argument !== "") return fail("201");
      if (initialized || finished) return fail("101");
      initialized = true;
      return succeed();
    },
    LMSFinish(argument) {
      if (argument !== "") return fail("201");
      if (!initialized) return fail("301");
      persist(false, true);
      initialized = false;
      finished = true;
      return succeed();
    },
    LMSGetValue(element) {
      if (!initialized) {
        fail("301");
        return "";
      }
      lastError = "0";
      return values[element] === undefined ? "" : String(values[element]);
    },
    LMSSetValue(element, value) {
      if (!initialized) return fail("301");
      if (readOnly.has(element)) return fail("403");
      if (element === "cmi.core.lesson_status" && !lessonStatuses.has(String(value)))
        return fail("405");
      values[element] = String(value);
      return succeed();
    },
    LMSCommit(argument) {
      if (argument !== "") return fail("201");
      if (!initialized) return fail("301");
      persist(false, false);
      return succeed();
    },
    LMSGetLastError() {
      return lastError;
    },
    LMSGetErrorString(code) {
      return errors[String(code)] || "Unknown error";
    },
    LMSGetDiagnostic(code) {
      return errors[String(code || lastError)] || "Unknown error";
    }
  };

  fetch(base + "?view=state", { credentials: "same-origin", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("SCORM session is unavailable");
      return response.json();
    })
    .then((state) => {
      initialTotalSeconds = state.totalTimeSeconds;
      values = {
        "cmi.core.student_id": state.learnerId,
        "cmi.core.student_name": state.learnerName,
        "cmi.core.credit": "credit",
        "cmi.core.entry": state.entry,
        "cmi.core.lesson_mode": "normal",
        "cmi.core.lesson_location": state.location,
        "cmi.core.lesson_status": state.lessonStatus === "not_attempted" ? "not attempted" : state.lessonStatus,
        "cmi.core.score.raw": state.scoreRaw === null ? "" : String(state.scoreRaw),
        "cmi.core.score.min": state.scoreMin === null ? "" : String(state.scoreMin),
        "cmi.core.score.max": state.scoreMax === null ? "" : String(state.scoreMax),
        "cmi.core.total_time": formatTime(state.totalTimeSeconds),
        "cmi.core.session_time": "00:00:00",
        "cmi.suspend_data": state.suspendData,
        "cmi.launch_data": ""
      };
      content.src = base + "/content/" + state.launchPath.split("/").map(encodeURIComponent).join("/");
      content.dataset.ready = "true";
      status.hidden = true;
    })
    .catch(() => {
      status.textContent = "This module could not be loaded. Return to the course and try again.";
      status.setAttribute("role", "alert");
    });

  window.addEventListener("pagehide", () => persist(true, false));
})();`;

export const SCORM_12_PREVIEW_RUNTIME = `(() => {
  "use strict";
  const root = document.documentElement;
  const packageVersionId = root.dataset.packageVersionId || "";
  const base = "/api/scorm/previews/" + encodeURIComponent(packageVersionId);
  const content = document.getElementById("scorm-content");
  const status = document.getElementById("scorm-status");
  let initialized = false;
  let finished = false;
  let lastError = "0";
  const values = Object.create(null);
  const errors = {
    "0": "No error",
    "101": "General exception",
    "201": "Invalid argument error",
    "301": "Not initialized"
  };

  function fail(code) { lastError = code; return "false"; }
  function succeed() { lastError = "0"; return "true"; }

  window.API = {
    LMSInitialize(argument) {
      if (argument !== "") return fail("201");
      if (initialized || finished) return fail("101");
      initialized = true;
      return succeed();
    },
    LMSFinish(argument) {
      if (argument !== "") return fail("201");
      if (!initialized) return fail("301");
      initialized = false;
      finished = true;
      return succeed();
    },
    LMSGetValue(element) {
      if (!initialized) { fail("301"); return ""; }
      lastError = "0";
      return values[element] === undefined ? "" : String(values[element]);
    },
    LMSSetValue(element, value) {
      if (!initialized) return fail("301");
      values[element] = String(value);
      return succeed();
    },
    LMSCommit(argument) {
      if (argument !== "") return fail("201");
      return initialized ? succeed() : fail("301");
    },
    LMSGetLastError() { return lastError; },
    LMSGetErrorString(code) { return errors[String(code)] || "Unknown error"; },
    LMSGetDiagnostic(code) { return errors[String(code || lastError)] || "Unknown error"; }
  };

  fetch(base + "?view=state", { credentials: "same-origin", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("SCORM preview is unavailable");
      return response.json();
    })
    .then((state) => {
      Object.assign(values, {
        "cmi.core.student_id": "preview",
        "cmi.core.student_name": "Administrator preview",
        "cmi.core.credit": "no-credit",
        "cmi.core.entry": "ab-initio",
        "cmi.core.lesson_mode": "browse",
        "cmi.core.lesson_status": "not attempted",
        "cmi.core.total_time": "00:00:00",
        "cmi.core.session_time": "00:00:00",
        "cmi.launch_data": "",
        "cmi.suspend_data": ""
      });
      content.src = base + "/content/" + state.launchPath.split("/").map(encodeURIComponent).join("/");
      content.dataset.ready = "true";
      status.hidden = true;
    })
    .catch(() => {
      status.textContent = "This SCORM version could not be loaded.";
      status.setAttribute("role", "alert");
    });
})();`;
