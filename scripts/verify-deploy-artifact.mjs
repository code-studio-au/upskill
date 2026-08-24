import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const temporaryDirectory = mkdtempSync(
  path.join(tmpdir(), "upskill-artifact-verification-"),
);
const artifactDirectory = path.join(temporaryDirectory, "artifacts");
const extractedDirectory = path.join(temporaryDirectory, "release");

try {
  const suppliedArtifact = process.env.UPSKILL_RELEASE_ARTIFACT;
  const artifactPath = suppliedArtifact
    ? path.resolve(root, suppliedArtifact)
    : path.join(artifactDirectory, `upskill-${releaseSha}.tar.gz`);
  if (!suppliedArtifact)
    execFileSync("bash", ["scripts/create-deploy-artifact.sh"], {
      cwd: root,
      env: { ...process.env, ARTIFACT_DIRECTORY: artifactDirectory },
      stdio: "inherit",
    });
  if (!existsSync(artifactPath))
    throw new Error(`Deploy artifact does not exist: ${artifactPath}`);
  const checksumPath = `${artifactPath}.sha256`;
  if (!existsSync(checksumPath))
    throw new Error(`Deploy artifact checksum does not exist: ${checksumPath}`);
  const expectedChecksum = readFileSync(checksumPath, "utf8").match(
    /^([a-f0-9]{64})\s/u,
  )?.[1];
  const actualChecksum = createHash("sha256")
    .update(readFileSync(artifactPath))
    .digest("hex");
  if (!expectedChecksum || actualChecksum !== expectedChecksum)
    throw new Error("Deploy artifact checksum does not match its sidecar");
  execFileSync("mkdir", ["-p", extractedDirectory]);
  execFileSync("tar", ["-xzf", artifactPath, "-C", extractedDirectory]);
  const manifest = JSON.parse(
    readFileSync(
      path.join(extractedDirectory, ".upskill-release.json"),
      "utf8",
    ),
  );
  if (manifest.gitSha !== releaseSha)
    throw new Error("Deploy artifact manifest SHA does not match HEAD");
  for (const relativePath of [
    "scripts/bootstrap-platform-admin.mjs",
    "scripts/invite-platform-admin.mjs",
    "scripts/validate-runtime-environment.ts",
    "deploy/scripts/bootstrap-platform-admin.sh",
    "deploy/scripts/invite-platform-admin.sh",
    "src/server/runtime-environment.ts",
    "src/validation/zod.server.ts",
  ])
    if (!existsSync(path.join(extractedDirectory, relativePath)))
      throw new Error(`Deploy artifact is missing ${relativePath}`);
  execFileSync(
    "pnpm",
    [
      "--dir",
      extractedDirectory,
      "--filter",
      "upskill",
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
    ],
    { stdio: "inherit" },
  );
  execFileSync(process.execPath, ["scripts/validate-runtime-environment.ts"], {
    cwd: extractedDirectory,
    env: {
      APP_ENV: "staging",
      APP_ORIGIN: "https://staging.codestudio.au",
      LEARNING_ORIGIN: "https://learn-staging.codestudio.au",
      SUPPORT_EMAIL: "support@codestudio.au",
      DATABASE_URL: "postgresql://web:secret@database/upskill",
      WORKER_DATABASE_URL: "postgresql://worker:secret@database/upskill",
      MIGRATION_DATABASE_URL: "postgresql://owner:secret@database/upskill",
      BETTER_AUTH_SECRET: "artifact-test-secret-that-is-at-least-32-characters",
      ACCESS_CODE_ENCRYPTION_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      STRIPE_SECRET_KEY: "rk_test_artifact",
      STRIPE_WEBHOOK_SECRET: "whsec_artifact",
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "artifact-domain-key",
      MAILGUN_DOMAIN: "mg.codestudio.au",
      MAILGUN_FROM: "Upskill <no-reply@codestudio.au>",
      SMS_PROVIDER: "textbee",
      TEXTBEE_API_KEY: "artifact-textbee-key",
      TEXTBEE_WEBHOOK_SECRET: "artifact-webhook-secret",
      AWS_REGION: "ap-southeast-2",
      S3_QUARANTINE_BUCKET: "upskill-staging-quarantine",
      S3_LEARNING_CONTENT_BUCKET: "upskill-staging-learning",
      S3_PRIVATE_RESOURCES_BUCKET: "upskill-staging-private",
      SQS_QUEUE_URL:
        "https://sqs.ap-southeast-2.amazonaws.com/123456789012/upskill-work",
      SQS_DEAD_LETTER_QUEUE_URL:
        "https://sqs.ap-southeast-2.amazonaws.com/123456789012/upskill-work-dlq",
      NODE_ENV: "production",
      UPSKILL_TRUST_PROXY: "true",
    },
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('./dist/server/server.js')",
    ],
    {
      cwd: extractedDirectory,
      env: {
        ...process.env,
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3000",
        LEARNING_ORIGIN: "http://127.0.0.1:3001",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
        BETTER_AUTH_SECRET:
          "artifact-test-secret-that-is-at-least-32-characters",
        STRIPE_SECRET_KEY: "rk_test_artifact",
        STRIPE_WEBHOOK_SECRET: "whsec_artifact",
      },
      stdio: "inherit",
    },
  );
  execFileSync(process.execPath, ["--check", "dist/worker/scorm-worker.js"], {
    cwd: extractedDirectory,
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    ["--check", "scripts/bootstrap-platform-admin.mjs"],
    { cwd: extractedDirectory, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--check", "scripts/invite-platform-admin.mjs"],
    {
      cwd: extractedDirectory,
      stdio: "inherit",
    },
  );
  execFileSync("bash", ["-n", "deploy/scripts/bootstrap-platform-admin.sh"], {
    cwd: extractedDirectory,
    stdio: "inherit",
  });
  execFileSync("bash", ["-n", "deploy/scripts/invite-platform-admin.sh"], {
    cwd: extractedDirectory,
    stdio: "inherit",
  });
  console.log("Verified immutable deploy artifact and production dependencies");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
