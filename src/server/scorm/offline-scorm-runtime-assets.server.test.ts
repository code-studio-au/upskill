import { beforeEach, describe, expect, it, vi } from "vitest";

const { environment } = vi.hoisted(() => ({
  environment: {
    APP_ENV: "test",
    APP_ORIGIN: "http://localhost:8080",
    LEARNING_ORIGIN: "http://learn.localhost:8080",
    OFFLINE_SCORM_PACKAGE_HOST_SUFFIX: "localhost",
  },
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => environment,
}));

import { handleOfflineScormLearningRuntimeRequest } from "./offline-scorm-runtime-assets.server";

describe("offline SCORM learning runtime assets", () => {
  beforeEach(() => {
    Object.assign(environment, {
      APP_ENV: "test",
      APP_ORIGIN: "http://localhost:8080",
      LEARNING_ORIGIN: "http://learn.localhost:8080",
      OFFLINE_SCORM_PACKAGE_HOST_SUFFIX: "localhost",
    });
  });

  it("permits cleanup requests to the certificate-free local package host", async () => {
    const response = await handleOfflineScormLearningRuntimeRequest(
      new Request(
        "http://learn.localhost:8080/api/scorm/offline-runtime/frame.html",
      ),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-security-policy")).toContain(
      "connect-src 'self' http://*.localhost:8080",
    );
    expect(response?.headers.get("content-security-policy")).not.toContain(
      "https://*.localhost",
    );
  });

  it("retains the HTTPS package wildcard outside local environments", async () => {
    Object.assign(environment, {
      APP_ENV: "production",
      APP_ORIGIN: "https://app.example.test",
      LEARNING_ORIGIN: "https://learn.example.test",
      OFFLINE_SCORM_PACKAGE_HOST_SUFFIX: "packages.example.test",
    });

    const response = await handleOfflineScormLearningRuntimeRequest(
      new Request(
        "https://learn.example.test/api/scorm/offline-runtime/frame.html",
      ),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://*.packages.example.test",
    );
  });

  it("omits the unprovisioned package wildcard from the staging runtime", async () => {
    Object.assign(environment, {
      APP_ENV: "staging",
      APP_ORIGIN: "https://staging.upskill.institute",
      LEARNING_ORIGIN: "https://learn-staging.upskill.institute",
      OFFLINE_SCORM_PACKAGE_HOST_SUFFIX: "com.au",
    });

    const response = await handleOfflineScormLearningRuntimeRequest(
      new Request(
        "https://learn-staging.upskill.institute/api/scorm/offline-runtime/frame.html",
      ),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(response?.headers.get("content-security-policy")).not.toContain(
      "*.com.au",
    );
  });
});
