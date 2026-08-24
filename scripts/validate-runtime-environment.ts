import { parseServerEnvironment } from "../src/server/runtime-environment.ts";

const deployedRuntimeKeys = [
  "DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "NODE_ENV",
  "UPSKILL_TRUST_PROXY",
] as const;

export function validateDeployedRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  const parsed = parseServerEnvironment(environment);
  if (parsed.APP_ENV !== "staging" && parsed.APP_ENV !== "production")
    throw new Error("Deployed APP_ENV must be staging or production");
  for (const key of deployedRuntimeKeys)
    if (!environment[key])
      throw new Error(`${key} is required in the deployment environment`);
  if (environment.NODE_ENV !== "production")
    throw new Error("Deployed NODE_ENV must be production");
  if (environment.UPSKILL_TRUST_PROXY !== "true")
    throw new Error("Deployed UPSKILL_TRUST_PROXY must be true");
}

if (import.meta.main) {
  validateDeployedRuntimeEnvironment(process.env);
  console.log("Validated deployed runtime environment");
}
