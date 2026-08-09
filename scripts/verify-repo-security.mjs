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
const zodAdapter = fs.readFileSync(
  path.join(root, "src/validation/zod.ts"),
  "utf8",
);
const serverZodAdapter = fs.readFileSync(
  path.join(root, "src/validation/zod.server.ts"),
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
if (packageJson.scripts.dev !== "node scripts/start-development.mjs")
  failures.push("Local development must start the web app and worker together");
const developmentLauncher = fs.readFileSync(
  path.join(root, "scripts/start-development.mjs"),
  "utf8",
);
for (const requiredProcess of ["vite", "src/worker/scorm-worker.ts"]) {
  if (!developmentLauncher.includes(requiredProcess))
    failures.push(
      `Local development launcher must include: ${requiredProcess}`,
    );
}
if (
  !developmentLauncher.includes('requireFromHere.resolve("vite/package.json")')
)
  failures.push("Local development must resolve Vite's JavaScript entry point");
if (developmentLauncher.includes("vite.cmd"))
  failures.push("Local development must not execute a Windows command shim");
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
if (!zodAdapter.includes("z.config({ jitless: true })"))
  failures.push("The shared Zod adapter must disable eval-based JIT probing");
if (!serverZodAdapter.includes("z.config({ jitless: true })"))
  failures.push("The server Zod adapter must disable eval-based JIT probing");
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
const webService = fs.readFileSync(
  path.join(root, "deploy/systemd/upskill-web.service"),
  "utf8",
);
for (const [name, service] of [
  ["web", webService],
  ["worker", workerService],
]) {
  if (
    !service.includes("StandardOutput=journal") ||
    !service.includes("StandardError=journal") ||
    !service.includes(`SyslogIdentifier=upskill-${name}`)
  )
    failures.push(`${name} service must route structured output to journald`);
}
const installRelease = fs.readFileSync(
  path.join(root, "deploy/scripts/install-release.sh"),
  "utf8",
);
if (!installRelease.includes('DEPLOYMENT_ID="%s"'))
  failures.push(
    "Release installation must expose the verified commit identity",
  );
const nginx = fs.readFileSync(
  path.join(root, "deploy/nginx/upskill.conf"),
  "utf8",
);
if (!nginx.includes("client_max_body_size 2m;"))
  failures.push("The default nginx request-body limit must remain 2 MB");
const scormUploadLocation = nginx.match(
  /location = \/api\/admin\/scorm-packages \{(?<body>[\s\S]*?)\n {4}\}/,
)?.groups?.body;
if (!scormUploadLocation?.includes("client_max_body_size 250m;"))
  failures.push(
    "The exact SCORM upload route must allow archives up to 250 MB",
  );
if (!scormUploadLocation?.includes("proxy_request_buffering off;"))
  failures.push("nginx must stream SCORM uploads instead of buffering them");

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
    !relative.startsWith("src/validation/zod") &&
    /from ["']zod(?:\/[^"']*)?["']/.test(contents)
  )
    failures.push(
      `Direct Zod import bypasses the CSP-safe adapter: ${relative}`,
    );
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
  if (
    contents.includes('.insertInto("audit_event")') &&
    relative !== "src/server/audit/audit-event.server.ts"
  )
    failures.push(`Audit writes bypass the typed boundary: ${relative}`);
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
