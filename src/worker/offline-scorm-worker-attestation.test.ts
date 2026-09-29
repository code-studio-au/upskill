import { describe, expect, it, vi } from "vitest";
import {
  createOfflineScormWorkerAttestor,
  OFFLINE_SCORM_WORKER_ATTESTATION_INTERVAL_MS,
} from "./offline-scorm-worker-attestation";

const allocatorTarget =
  "arn:aws:lambda:ap-southeast-2:123456789012:function:allocator:12";

describe("createOfflineScormWorkerAttestor", () => {
  it("does nothing when the allocator is not configured", async () => {
    const runAws = vi.fn();
    const attestor = createOfflineScormWorkerAttestor(
      {
        APP_ENV: "development",
        AWS_REGION: "ap-southeast-2",
        OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME: undefined,
      },
      { runAws },
    );

    await attestor.attestIfDue();

    expect(runAws).not.toHaveBeenCalled();
  });

  it("attests the effective target at startup and refreshes its lease", async () => {
    let observedAt = Date.parse("2026-09-29T00:00:00Z");
    const runAws = vi.fn().mockResolvedValue(undefined);
    const attestor = createOfflineScormWorkerAttestor(
      {
        APP_ENV: "staging",
        AWS_REGION: "ap-southeast-2",
        OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME: allocatorTarget,
      },
      { now: () => observedAt, runAws },
    );

    await attestor.attestIfDue();
    observedAt += OFFLINE_SCORM_WORKER_ATTESTATION_INTERVAL_MS - 1;
    await attestor.attestIfDue();
    observedAt += 1;
    await attestor.attestIfDue();

    expect(runAws).toHaveBeenCalledTimes(2);
    expect(runAws).toHaveBeenLastCalledWith([
      "ssm",
      "put-parameter",
      "--region",
      "ap-southeast-2",
      "--name",
      "/upskill/staging/offline-scorm/cloudfront-worker-runtime-target",
      "--type",
      "String",
      "--value",
      allocatorTarget,
      "--overwrite",
    ]);
  });

  it("keeps a failed attestation due so worker startup cannot mask it", async () => {
    const runAws = vi
      .fn()
      .mockRejectedValueOnce(new Error("SSM unavailable"))
      .mockResolvedValueOnce(undefined);
    const attestor = createOfflineScormWorkerAttestor(
      {
        APP_ENV: "staging",
        AWS_REGION: "ap-southeast-2",
        OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME: allocatorTarget,
      },
      { now: () => Date.parse("2026-09-29T00:00:00Z"), runAws },
    );

    await expect(attestor.attestIfDue()).rejects.toThrow("SSM unavailable");
    await attestor.attestIfDue();

    expect(runAws).toHaveBeenCalledTimes(2);
  });
});
