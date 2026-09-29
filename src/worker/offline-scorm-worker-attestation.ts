import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ServerEnv } from "#/server/runtime-environment";

const execFileAsync = promisify(execFile);

export const OFFLINE_SCORM_WORKER_ATTESTATION_INTERVAL_MS = 5 * 60_000;

type AttestationEnvironment = Pick<
  ServerEnv,
  "APP_ENV" | "AWS_REGION" | "OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME"
>;

type AttestationDependencies = {
  now?: () => number;
  runAws?: (args: string[]) => Promise<void>;
};

async function runAwsCli(args: string[]): Promise<void> {
  await execFileAsync("aws", [...args, "--no-cli-pager"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
}

export function createOfflineScormWorkerAttestor(
  environment: AttestationEnvironment,
  dependencies: AttestationDependencies = {},
): { attestIfDue: () => Promise<void> } {
  const target = environment.OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME;
  if (target === undefined) return { attestIfDue: () => Promise.resolve() };

  const now = dependencies.now ?? Date.now;
  const runAws = dependencies.runAws ?? runAwsCli;
  const parameterName = `/upskill/${environment.APP_ENV}/offline-scorm/cloudfront-worker-runtime-target`;
  let nextAttestationAt = 0;

  return {
    async attestIfDue(): Promise<void> {
      const observedAt = now();
      if (observedAt < nextAttestationAt) return;
      await runAws([
        "ssm",
        "put-parameter",
        "--region",
        environment.AWS_REGION,
        "--name",
        parameterName,
        "--type",
        "String",
        "--value",
        target,
        "--overwrite",
      ]);
      nextAttestationAt =
        observedAt + OFFLINE_SCORM_WORKER_ATTESTATION_INTERVAL_MS;
    },
  };
}
