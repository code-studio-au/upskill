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
const applicationCsp = csp.slice(
  csp.indexOf("const DIRECTIVES"),
  csp.indexOf("export function buildLearningContentSecurityPolicy"),
);
const learningCsp = csp.slice(
  csp.indexOf("export function buildLearningContentSecurityPolicy"),
  csp.indexOf("export function applySecurityHeaders"),
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
if (
  !packageJson.scripts["verify:app:static"].includes(
    "pnpm run verify:migration-baseline",
  )
)
  failures.push("The frozen migration baseline must run in application CI");
const migrationBaselineVerifier = fs.readFileSync(
  path.join(root, "scripts/verify-migration-baseline.mjs"),
  "utf8",
);
for (const invariant of [
  'const baselineTag = "schema-baseline-v1"',
  'const baselineCommit = "cb80bffde984ba68a71be83808bff4766ac21e58"',
  '"merge-base", "--is-ancestor"',
  '["show", `${baselineTag}:${repositoryPath}`]',
])
  if (!migrationBaselineVerifier.includes(invariant))
    failures.push(`Migration baseline anchor is missing: ${invariant}`);
if (!packageJson.scripts.build.includes("vite.worker.config.ts"))
  failures.push("Production builds must include the asynchronous worker");
if (
  packageJson.scripts.dev !==
  "zsh -lc 'source \"$NVM_DIR/nvm.sh\" && nvm use 26 && exec node --env-file-if-exists=.env.local scripts/start-development.mjs'"
)
  failures.push(
    "Local development must select Node 26, load local configuration and start the supervised services",
  );
const disposablePostgres = fs.readFileSync(
  path.join(root, "scripts/disposable-postgres.mjs"),
  "utf8",
);
for (const scriptName of [
  "test:e2e",
  "test:e2e:core",
  "test:e2e:scorm",
  "test:e2e:admin",
  "test:e2e:https",
])
  if (!packageJson.scripts[scriptName]?.includes("run-browser-tests.mjs"))
    failures.push(
      `${scriptName} must use the disposable browser-test database`,
    );
for (const boundary of [
  "Disposable test databases require a PostgreSQL server on localhost",
  "create database",
  "pg_terminate_backend",
  "drop database",
])
  if (!disposablePostgres.includes(boundary))
    failures.push(`Disposable PostgreSQL boundary is missing: ${boundary}`);
if (
  packageJson.scripts["verify:db:gate"] !==
  "node --env-file-if-exists=.env.local scripts/run-database-verification.mjs"
)
  failures.push(
    "The database verification gate must use a disposable database",
  );
for (const [scriptName, command] of Object.entries(packageJson.scripts))
  if (
    scriptName.startsWith("db:verify:") &&
    !command.includes("scripts/run-database-verification.mjs")
  )
    failures.push(`${scriptName} must use a disposable database`);
const playwrightConfig = fs.readFileSync(
  path.join(root, "playwright.config.ts"),
  "utf8",
);
if (!playwrightConfig.includes("reuseExistingServer: false"))
  failures.push("Playwright must never reuse a developer server");
const developmentLauncher = fs.readFileSync(
  path.join(root, "scripts/start-development.mjs"),
  "utf8",
);
for (const requiredProcess of [
  "vite",
  "src/worker/scorm-worker.ts",
  "src/server/db/migrate.ts",
  "await runMigrations()",
  "createStripeDevelopmentSetup",
  "--strictPort",
]) {
  if (!developmentLauncher.includes(requiredProcess))
    failures.push(
      `Local development launcher must include: ${requiredProcess}`,
    );
}
if (
  developmentLauncher.indexOf("await runMigrations()") >
  developmentLauncher.indexOf("const definitions")
)
  failures.push(
    "Local development must migrate before starting supervised services",
  );
const stripeDevelopment = fs.readFileSync(
  path.join(root, "scripts/stripe-development.mjs"),
  "utf8",
);
for (const invariant of [
  '"listen"',
  '"--print-secret"',
  '"checkout.session.completed"',
  '"refund.created"',
  '"http://localhost:3000/api/stripe/webhook"',
  'stdio: ["ignore", "ignore", "ignore"]',
])
  if (!stripeDevelopment.includes(invariant))
    failures.push(`Stripe development listener is missing: ${invariant}`);
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
if (!applicationCsp.includes('"script-src-attr": ["\'none\'"]'))
  failures.push("Application CSP must prohibit script attributes");
if (
  !applicationCsp.includes(
    "\"script-src\": [\"'self'\", `'nonce-${nonce}'`, \"'strict-dynamic'\"]",
  )
)
  failures.push("Application CSP script-src must remain nonce-only");
if (!applicationCsp.includes('"style-src-attr": ["\'unsafe-inline\'"]'))
  failures.push("Mantine style-attribute exception must stay explicit");
if (
  !applicationCsp.includes(
    "\"style-src-elem\": [\"'self'\", `'nonce-${nonce}'`]",
  )
)
  failures.push("Style elements must require the request nonce");
for (const learningException of [
  '"script-src": ["\'self\'", "\'unsafe-inline\'", "\'unsafe-eval\'"]',
  '"script-src-attr": ["\'unsafe-inline\'"]',
  '"style-src-attr": ["\'unsafe-inline\'"]',
  '"https://embed.articulateusercontent.com"',
]) {
  if (!learningCsp.includes(learningException))
    failures.push(
      `Learning-origin SCORM compatibility policy is missing: ${learningException}`,
    );
}
const scormLauncher = fs.readFileSync(
  path.join(root, "src/features/learning/FullscreenScormLauncher.tsx"),
  "utf8",
);
if (
  !scormLauncher.includes(
    'sandbox="allow-downloads allow-popups allow-same-origin allow-scripts"',
  )
)
  failures.push(
    "The SCORM sandbox must retain the bounded download and popup compatibility profile",
  );
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
if (!applicationStack.includes('UPSKILL_TRUST_PROXY: "true"'))
  failures.push("The loopback-only nginx deployment must preserve client IPs");
for (const requiredAccessCodeBoundary of [
  '"AccessCodeEncryptionKey"',
  "accessCodeEncryptionSecret.grantRead(role)",
  "ACCESS_CODE_ENCRYPTION_KEY",
]) {
  if (!applicationStack.includes(requiredAccessCodeBoundary))
    failures.push(
      `The deployed access-code encryption boundary is missing: ${requiredAccessCodeBoundary}`,
    );
}
for (const relative of [
  ".env.example",
  "deploy/cdk/lib/application-stack.ts",
  "src/server/runtime-environment.ts",
]) {
  if (
    !fs
      .readFileSync(path.join(root, relative), "utf8")
      .includes("TEXTBEE_WEBHOOK_SECRET")
  )
    failures.push(
      `TextBee webhook signing configuration is missing: ${relative}`,
    );
}
const textBeeWebhook = fs.readFileSync(
  path.join(root, "src/server/notifications/textbee-webhook.server.ts"),
  "utf8",
);
for (const boundary of [
  'createHmac("sha256", secret).update(payload)',
  "timingSafeEqual",
  'insertInto("sms_delivery_webhook_event")',
])
  if (!textBeeWebhook.includes(boundary))
    failures.push(`TextBee webhook security boundary is missing: ${boundary}`);
for (const relative of [
  ".env.example",
  ".github/workflows/ci.yml",
  "deploy/cdk/lib/application-stack.ts",
  "src/server/runtime-environment.ts",
]) {
  if (
    fs
      .readFileSync(path.join(root, relative), "utf8")
      .includes("ACCESS_CODE_PEPPER")
  )
    failures.push(
      `Access-code lookup must not require an HMAC secret: ${relative}`,
    );
}
const workerService = fs.readFileSync(
  path.join(root, "deploy/systemd/upskill-worker.service"),
  "utf8",
);
if (
  !workerService.includes(
    "ExecStart=/usr/local/bin/node dist/worker/scorm-worker.js",
  )
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
if (
  !webService.includes("EnvironmentFile=/opt/upskill/shared/upskill-web.env") ||
  !workerService.includes(
    "EnvironmentFile=/opt/upskill/shared/upskill-worker.env",
  )
)
  failures.push("Runtime services must use separate database environments");
if (
  webService.includes("upskill-deploy.env") ||
  workerService.includes("upskill-deploy.env")
)
  failures.push("Runtime services must not receive migration credentials");
const installRelease = fs.readFileSync(
  path.join(root, "deploy/scripts/install-release.sh"),
  "utf8",
);
const provisionRuntimeRoles = fs.readFileSync(
  path.join(root, "src/server/db/provision-runtime-roles.ts"),
  "utf8",
);
if (!provisionRuntimeRoles.includes("$1::text"))
  failures.push(
    "Runtime database-role password formatting must type its bound parameter",
  );
if (!installRelease.includes('DEPLOYMENT_ID="%s"'))
  failures.push(
    "Release installation must expose the verified commit identity",
  );
for (const invariant of [
  "sha256sum",
  "flock -n",
  "src/server/db/migrate.ts",
  "src/server/db/provision-runtime-roles.ts",
  "upskill-deploy.env",
  'write_deployment_id "$release_sha"',
  'write_deployment_id "$previous_sha"',
  "scripts/validate-runtime-environment.ts",
  "http://127.0.0.1:3000/api/ready?deploymentId=${previous_sha}",
  "http://127.0.0.1:3000/api/ready?deploymentId=",
  "Release failed readiness checks and was rolled back",
  "/usr/local/sbin/upskill-bootstrap-platform-admin",
])
  if (!installRelease.includes(invariant))
    failures.push(`Release installation safety is missing: ${invariant}`);
const environmentPreflightIndex = installRelease.indexOf(
  "scripts/validate-runtime-environment.ts",
);
const migrationIndex = installRelease.indexOf("src/server/db/migrate.ts");
if (
  environmentPreflightIndex < 0 ||
  migrationIndex < 0 ||
  environmentPreflightIndex > migrationIndex
)
  failures.push(
    "The deployed runtime environment must be validated before migrations",
  );
const deployWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/deploy.yml"),
  "utf8",
);
const ciWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/ci.yml"),
  "utf8",
);
for (const [name, workflow] of [
  ["CI", ciWorkflow],
  ["deployment", deployWorkflow],
])
  if (!workflow.includes("fetch-depth: 0"))
    failures.push(`${name} verification must fetch the migration baseline tag`);
for (const invariant of [
  'GITHUB_REF" != "refs/heads/main',
  'REQUESTED_RELEASE_SHA" != "$GITHUB_SHA',
  "attestations: write",
  "artifact-metadata: write",
  "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  "UPSKILL_RELEASE_ARTIFACT: artifacts/upskill-${{ github.sha }}.tar.gz",
  "subject-path: artifacts/upskill-${{ github.sha }}.tar.gz",
])
  if (!deployWorkflow.includes(invariant))
    failures.push(`Deployment authorization is missing: ${invariant}`);
const attestationIndex = deployWorkflow.indexOf("actions/attest@");
const artifactUploadIndex = deployWorkflow.indexOf(
  'aws s3 cp "artifacts/upskill-${GITHUB_SHA}.tar.gz"',
);
if (
  attestationIndex < 0 ||
  artifactUploadIndex < 0 ||
  attestationIndex > artifactUploadIndex
)
  failures.push("The release artifact must be attested before S3 upload");
const workflowChecksumIndex = deployWorkflow.indexOf(
  "sha256sum --check --strict -",
);
const workflowExtractionIndex = deployWorkflow.indexOf(
  "tar -xOf /tmp/upskill-release.tar.gz",
);
if (
  workflowChecksumIndex < 0 ||
  workflowExtractionIndex < 0 ||
  workflowChecksumIndex > workflowExtractionIndex
)
  failures.push(
    "Deployment must verify the downloaded artifact before extracting its installer",
  );
const deploymentIdentity = fs.readFileSync(
  path.join(root, "deploy/cdk/lib/deployment-identity-stack.ts"),
  "utf8",
);
for (const invariant of [
  "ArnFormat.SLASH_RESOURCE_NAME",
  'resource: "oidc-provider"',
  'resourceName: "token.actions.githubusercontent.com"',
  '"ssm:resourceTag/Application": "upskill"',
  '"ssm:resourceTag/Environment": props.environment',
])
  if (!deploymentIdentity.includes(invariant))
    failures.push(
      `Shared GitHub OIDC provider reference is missing: ${invariant}`,
    );
const cdkEntrypoint = fs.readFileSync(
  path.join(root, "deploy/cdk/bin/upskill.ts"),
  "utf8",
);
if (cdkEntrypoint.includes("GitHubIdentityProviderStack"))
  failures.push(
    "Upskill must reference the account-wide GitHub OIDC provider instead of owning a duplicate",
  );
const cdkConfiguration = JSON.parse(
  fs.readFileSync(path.join(root, "deploy/cdk/cdk.json"), "utf8"),
);
if (cdkConfiguration.context?.githubOwner !== "code-studio-au")
  failures.push("GitHub OIDC must trust the canonical repository owner");
if (cdkConfiguration.context?.githubOwnerId !== "187219708")
  failures.push("GitHub OIDC must trust the immutable repository owner ID");
if (cdkConfiguration.context?.githubRepository !== "upskill")
  failures.push("GitHub OIDC must trust the canonical repository name");
if (cdkConfiguration.context?.githubRepositoryId !== "1327543633")
  failures.push("GitHub OIDC must trust the immutable repository ID");
const bootstrapAdministrator = fs.readFileSync(
  path.join(root, "scripts/bootstrap-platform-admin.mjs"),
  "utf8",
);
for (const invariant of [
  "MIGRATION_DATABASE_URL is required to bootstrap a deployed environment",
  "pg_advisory_xact_lock",
  'user.accountState !== "active"',
  "!user.emailVerified",
  "authorization.platform_admin.bootstrapped",
  "first_environment_bootstrap",
])
  if (!bootstrapAdministrator.includes(invariant))
    failures.push(
      `Platform-administrator bootstrap boundary is missing: ${invariant}`,
    );
const nginx = fs.readFileSync(
  path.join(root, "deploy/nginx/upskill.conf"),
  "utf8",
);
if (!nginx.includes("client_max_body_size 2m;"))
  failures.push("The default nginx request-body limit must remain 2 MB");
if (
  nginx.includes("proxy_pass") ||
  !nginx.includes('return 503 "Upskill is completing secure staging setup') ||
  !nginx.includes("/.well-known/acme-challenge/")
)
  failures.push(
    "Pre-TLS nginx must expose only ACME and a non-cacheable maintenance response",
  );
const productionNginx = fs.readFileSync(
  path.join(root, "deploy/nginx/upskill.https.conf.template"),
  "utf8",
);
const scormUploadLocation = productionNginx.match(
  /location = \/api\/admin\/scorm-packages \{(?<body>[\s\S]*?)\n {4}\}/,
)?.groups?.body;
if (!scormUploadLocation?.includes("client_max_body_size 250m;"))
  failures.push(
    "The exact SCORM upload route must allow archives up to 250 MB",
  );
if (!scormUploadLocation?.includes("proxy_request_buffering off;"))
  failures.push("nginx must stream SCORM uploads instead of buffering them");
const resourceUploadLocation = productionNginx.match(
  /location = \/api\/admin\/resources \{(?<body>[\s\S]*?)\n {4}\}/,
)?.groups?.body;
if (!resourceUploadLocation?.includes("client_max_body_size 25m;"))
  failures.push(
    "The exact PDF resource upload route must allow documents up to 25 MB",
  );
if (!resourceUploadLocation?.includes("proxy_request_buffering off;"))
  failures.push(
    "nginx must stream PDF resource uploads instead of buffering them",
  );

if (!packageJson.scripts?.build?.includes("precompress-client-assets.mjs"))
  failures.push("Production builds must create verified compression sidecars");
const viteConfig = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
if (!viteConfig.includes("sourcemap: false"))
  failures.push("Production runtime builds must exclude source maps");
const workerViteConfig = fs.readFileSync(
  path.join(root, "vite.worker.config.ts"),
  "utf8",
);
if (!workerViteConfig.includes("sourcemap: false"))
  failures.push("Production worker builds must exclude source maps");
const clientPrecompression = fs.readFileSync(
  path.join(root, "scripts/precompress-client-assets.mjs"),
  "utf8",
);
if (clientPrecompression.includes('".map"'))
  failures.push("Source maps must not be precompressed into runtime artifacts");
const startServer = fs.readFileSync(
  path.join(root, "scripts/start-server.mjs"),
  "utf8",
);
for (const invariant of [
  "UPSKILL_TLS_CERT_FILE",
  "UPSKILL_TRUST_PROXY",
  '!trustProxy || !headers.has("x-real-ip")',
  'encoding === "br"',
  'encoding === "gzip"',
  "constants.Z_SYNC_FLUSH",
  'appendVary(outgoing.getHeader("vary"), "Accept-Encoding")',
  'requestPath === "/api/ready"',
  'readinessPool.query("select 1")',
  "requestedDeployment === deploymentId",
])
  if (!startServer.includes(invariant))
    failures.push(`Local HTTPS compression boundary is missing: ${invariant}`);

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
