import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  execFileSync("bash", ["scripts/create-deploy-artifact.sh"], {
    cwd: root,
    env: { ...process.env, ARTIFACT_DIRECTORY: artifactDirectory },
    stdio: "inherit",
  });
  const artifactPath = path.join(
    artifactDirectory,
    `upskill-${releaseSha}.tar.gz`,
  );
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
  console.log("Verified immutable deploy artifact and production dependencies");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
