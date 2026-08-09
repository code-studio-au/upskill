import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"),
);
const eslintConfig = fs.readFileSync(
  path.join(root, "eslint.config.js"),
  "utf8",
);
const csp = fs.readFileSync(
  path.join(root, "src/server/http/security-headers.ts"),
  "utf8",
);

if (
  fs.readFileSync(path.join(root, ".node-version"), "utf8").trim() !== "26.7.0"
)
  failures.push("Node runtime pin must be 26.7.0");
if (packageJson.engines.node !== ">=26 <27")
  failures.push("Node engine must reject non-26 runtimes");
for (const option of [
  "strict",
  "exactOptionalPropertyTypes",
  "forceConsistentCasingInFileNames",
  "noFallthroughCasesInSwitch",
  "noImplicitOverride",
  "noImplicitReturns",
  "noUncheckedIndexedAccess",
  "noUncheckedSideEffectImports",
  "noUnusedLocals",
  "noUnusedParameters",
  "useUnknownInCatchVariables",
]) {
  if (tsconfig.compilerOptions[option] !== true)
    failures.push(`TypeScript compiler option must remain enabled: ${option}`);
}
for (const option of ["allowUnreachableCode", "allowUnusedLabels"]) {
  if (tsconfig.compilerOptions[option] !== false)
    failures.push(`TypeScript compiler option must remain disabled: ${option}`);
}
if (!eslintConfig.includes("tseslint.configs.strictTypeChecked"))
  failures.push("ESLint must use the strict type-checked TypeScript preset");
if (packageJson.devDependencies["react-doctor"] !== "0.9.7")
  failures.push("React Doctor must remain exact-pinned");
if (!packageJson.scripts.doctor.includes("--blocking error"))
  failures.push("React Doctor must fail verification on error diagnostics");
if (!packageJson.scripts["verify:app:static"].includes("pnpm run doctor"))
  failures.push("React Doctor must remain part of application verification");
if (!packageJson.scripts.build.includes("vite.worker.config.ts"))
  failures.push("Production builds must include the asynchronous worker");
for (const forbidden of ["package-lock.json", "yarn.lock"]) {
  if (fs.existsSync(path.join(root, forbidden)))
    failures.push(`Forbidden repository file: ${forbidden}`);
}
for (const sensitive of [".env", ".env.local"]) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", sensitive], {
      cwd: root,
      stdio: "ignore",
    });
    failures.push(`Sensitive environment file is tracked: ${sensitive}`);
  } catch {
    // An ignored local environment file is expected during local verification.
  }
}
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
if (!gitignore.split(/\r?\n/).includes(".env"))
  failures.push(".gitignore must ignore .env");
if (!gitignore.split(/\r?\n/).includes(".env.*"))
  failures.push(".gitignore must ignore environment variants");
if (!csp.includes('"script-src-attr": ["\'none\'"]'))
  failures.push("CSP must prohibit script attributes");
if (/script-src[^\n]*unsafe-inline/.test(csp))
  failures.push("CSP script-src must not allow unsafe-inline");
if (!csp.includes('"style-src-attr": ["\'unsafe-inline\'"]'))
  failures.push("Mantine style-attribute exception must stay explicit");
if (!csp.includes("\"style-src-elem\": [\"'self'\", `'nonce-${nonce}'`]"))
  failures.push("Style elements must require the request nonce");
const applicationStack = fs.readFileSync(
  path.join(root, "deploy/cdk/lib/application-stack.ts"),
  "utf8",
);
if (!applicationStack.includes("SQS_QUEUE_URL: props.workQueue.queueUrl"))
  failures.push("The deployed worker must receive its CDK-managed queue URL");
const workerService = fs.readFileSync(
  path.join(root, "deploy/systemd/upskill-worker.service"),
  "utf8",
);
if (
  !workerService.includes("ExecStart=/usr/bin/node dist/worker/scorm-worker.js")
)
  failures.push("The worker service must execute the bundled release artifact");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

for (const file of sourceFiles(path.join(root, "src"))) {
  const relative = path.relative(root, file);
  const contents = fs.readFileSync(file, "utf8");
  if (
    /\bstyle\s*=\s*\{\{/.test(contents) ||
    /\bstyles\s*=\s*\{\{/.test(contents)
  )
    failures.push(`Inline React styles are prohibited: ${relative}`);
  const sensitiveImport = /from ['"](?:pg|stripe|kysely|@aws-sdk\/)/.test(
    contents,
  );
  const allowedBoundary =
    relative.includes("/server/") ||
    relative.includes("/migrations/") ||
    relative === "src/server.ts";
  if (sensitiveImport && !allowedBoundary)
    failures.push(`Sensitive dependency outside server boundary: ${relative}`);
}

for (const route of ["ssr: true", 'ssr: "data-only"', "ssr: false"]) {
  const represented = sourceFiles(path.join(root, "src/routes")).some((file) =>
    fs.readFileSync(file, "utf8").includes(route),
  );
  if (!represented)
    failures.push(`Rendering policy is not represented in routes: ${route}`);
}

if (failures.length > 0) throw new Error(failures.join("\n"));
console.log(
  "Verified repository pins, CSP invariants, rendering policy and server boundaries",
);
