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
if (packageJson.dependencies.tsx !== "4.23.11")
  failures.push(
    "The deployed TypeScript seed loader requires pinned production tsx",
  );
if (packageJson.dependencies["livekit-server-sdk"] !== "2.18.0")
  failures.push("The server-only LiveKit SDK must remain exact-pinned");
if (packageJson.devDependencies.tsx !== undefined)
  failures.push("tsx must not be scoped only to development dependencies");
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
const browserTestRunner = fs.readFileSync(
  path.join(root, "scripts/run-browser-tests.mjs"),
  "utf8",
);
const databaseTestRunner = fs.readFileSync(
  path.join(root, "scripts/run-database-verification.mjs"),
  "utf8",
);
const deployArtifactVerifier = fs.readFileSync(
  path.join(root, "scripts/verify-deploy-artifact.mjs"),
  "utf8",
);
for (const invariant of [
  'all: [["test"]]',
  '"--project=chromium-mobile-scorm"',
  '"--project=chromium-mobile-admin"',
  '"--no-deps"',
])
  if (!browserTestRunner.includes(invariant))
    failures.push(`Browser-test orchestration is missing: ${invariant}`);
for (const [name, runner] of [
  ["Browser", browserTestRunner],
  ["Database", databaseTestRunner],
  ["Release artifact", deployArtifactVerifier],
])
  for (const invariant of [
    'LIVEKIT_ENABLED: "false"',
    'LIVEKIT_PROJECT_ENVIRONMENT: "test"',
  ])
    if (!runner.includes(invariant))
      failures.push(
        `${name} verification must isolate local LiveKit configuration: ${invariant}`,
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
for (const invariant of [
  'name: "chromium-mobile-scorm"',
  'dependencies: ["chromium-mobile", "firefox", "webkit"]',
  'name: "chromium-mobile-admin"',
  'dependencies: ["chromium-mobile-scorm"]',
])
  if (!playwrightConfig.includes(invariant))
    failures.push(`Playwright project sequencing is missing: ${invariant}`);
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
const stagingSeedRunner = fs.readFileSync(
  path.join(root, "deploy/scripts/seed-staging.sh"),
  "utf8",
);
if (stagingSeedRunner.includes('source "$seed_environment"'))
  failures.push(
    "The protected staging seed file must never be executed as shell",
  );
const deployedEnvironmentCheck = stagingSeedRunner.indexOf(
  'if [[ "$deployed_app_environment" != "staging" ]]',
);
const seedEnvironmentRead = stagingSeedRunner.indexOf(
  'done < "$seed_environment"',
);
if (
  deployedEnvironmentCheck < 0 ||
  seedEnvironmentRead < 0 ||
  deployedEnvironmentCheck > seedEnvironmentRead
)
  failures.push(
    "The authoritative deployed environment must be validated before seed settings are read",
  );
for (const invariant of [
  'case "$key" in',
  "ALLOW_STAGING_SEED | SEED_ASSET_DIRECTORY | SEED_LEARNER_PASSWORD | SEED_SMS_TEST_PHONE | SEED_SMS_TEST_USER_EMAIL)",
  "APP_ENV=$deployed_app_environment",
  "DATABASE_URL=${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}",
])
  if (!stagingSeedRunner.includes(invariant))
    failures.push(`Staging seed boundary is missing: ${invariant}`);
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
const storageStack = fs.readFileSync(
  path.join(root, "deploy/cdk/lib/storage-stack.ts"),
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
for (const requiredLiveKitBoundary of [
  '"LiveKitConfiguration"',
  "liveKitConfigurationSecret.grantRead(role)",
  "livekit_json",
]) {
  if (!applicationStack.includes(requiredLiveKitBoundary))
    failures.push(
      `The dormant LiveKit configuration boundary is missing: ${requiredLiveKitBoundary}`,
    );
}
for (const requiredRecordingStorageBoundary of [
  'new Bucket(this, "RecordingBucket"',
  "blockPublicAccess: BlockPublicAccess.BLOCK_ALL",
  "enforceSSL: true",
  "versioned: true",
  "abortIncompleteMultipartUploadAfter: Duration.days(1)",
]) {
  if (!storageStack.includes(requiredRecordingStorageBoundary))
    failures.push(
      `The private recording storage boundary is missing: ${requiredRecordingStorageBoundary}`,
    );
}
if (!applicationStack.includes("S3_RECORDING_BUCKET"))
  failures.push("The deployed server must receive its recording bucket name");
if (
  !applicationStack.includes(
    'actions: ["s3:GetObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]',
  ) ||
  !applicationStack.includes('actions: ["s3:ListBucketVersions"]') ||
  !applicationStack.includes('StringLike: { "s3:prefix": ["recordings/*"] }')
)
  failures.push(
    "The application role must have scoped recording read and retention access",
  );
for (const requiredRecordingUploadBoundary of [
  'new Role(this, "RecordingUploadRole"',
  "maxSessionDuration: Duration.hours(1)",
  'actions: ["s3:PutObject"]',
  "recordingUploadRole.grantAssumeRole(role)",
  "instance.node.addDependency(recordingUploadRoleParameter)",
  "new StringParameter(",
  '"RecordingUploadRoleParameter"',
  'actions: ["ssm:GetParameter"]',
  "/livekit/recording-upload-role-arn",
  "LIVEKIT_RECORDING_UPLOAD_ROLE_ARN",
  '"RecordingAccessGrantsAccountParameter"',
  "/livekit/recording-access-grants-account-id",
  "LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID",
]) {
  if (!applicationStack.includes(requiredRecordingUploadBoundary))
    failures.push(
      `The scoped recording upload role is missing: ${requiredRecordingUploadBoundary}`,
    );
}
if (
  applicationStack.includes(
    "LIVEKIT_RECORDING_UPLOAD_ROLE_ARN: recordingUploadRole.roleArn",
  )
)
  failures.push(
    "The recording upload role ARN must not mutate the generated application secret template",
  );
if (
  applicationStack.includes(
    "LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID: this.account",
  )
)
  failures.push(
    "The Access Grants account ID must not mutate the generated application secret template",
  );
const recordingUploadAuthorizer = fs.readFileSync(
  path.join(
    root,
    "src/server/livekit/livekit-recording-upload-authorizer.aws.server.ts",
  ),
  "utf8",
);
for (const requiredRecordingAuthorizationBoundary of [
  'import "@tanstack/react-start/server-only"',
  "new AssumeRoleCommand",
  'Action: "s3:PutObject"',
  "LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY",
  "parseLiveKitRecordingStorageObjectKey",
]) {
  if (
    !recordingUploadAuthorizer.includes(requiredRecordingAuthorizationBoundary)
  )
    failures.push(
      `The exact-object recording authorization boundary is missing: ${requiredRecordingAuthorizationBoundary}`,
    );
}
const productionRecordingUploadAuthorizer = fs.readFileSync(
  path.join(
    root,
    "src/server/livekit/livekit-recording-upload-authorizer.access-grants.aws.server.ts",
  ),
  "utf8",
);
for (const requiredProductionRecordingAuthorizationBoundary of [
  'import "@tanstack/react-start/server-only"',
  "new GetDataAccessCommand",
  "Permission: Permission.WRITE",
  "Privilege: Privilege.Minimal",
  "TargetType: S3PrefixType.Object",
  "LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY",
  "response.MatchedGrantTarget !== target",
  "parseLiveKitRecordingStorageObjectKey",
]) {
  if (
    !productionRecordingUploadAuthorizer.includes(
      requiredProductionRecordingAuthorizationBoundary,
    )
  )
    failures.push(
      `The production recording authorization boundary is missing: ${requiredProductionRecordingAuthorizationBoundary}`,
    );
}
const recordingDurationPolicy = fs.readFileSync(
  path.join(
    root,
    "src/server/livekit/livekit-recording-duration-policy.server.ts",
  ),
  "utf8",
);
for (const requiredRecordingDurationBoundary of [
  'import "@tanstack/react-start/server-only"',
  "maximumLifetimeMilliseconds: 60 * MINUTE_MILLISECONDS",
  "finalizationReserveMilliseconds: 5 * MINUTE_MILLISECONDS",
  "maximumLifetimeMilliseconds: 12 * 60 * MINUTE_MILLISECONDS",
  "finalizationReserveMilliseconds: 60 * MINUTE_MILLISECONDS",
  "recordingUploadAuthorizationPolicyForEnvironment",
  "maximumAutomaticRecordingWindowMinutes",
  "recordingUploadAuthorizationExpiresAt",
  "scheduledEndsAt",
  "supportsAutomaticRecordingDurations",
  "supportsAutomaticRecordingSessionWindow",
  "presenterPreparationMilliseconds",
  "item.liveKitPolicy.presenterPreparationMinutes",
]) {
  if (!recordingDurationPolicy.includes(requiredRecordingDurationBoundary))
    failures.push(
      `The automatic recording duration boundary is missing: ${requiredRecordingDurationBoundary}`,
    );
}
const eventVirtualRoomServer = fs.readFileSync(
  path.join(root, "src/server/events/event-virtual-room.server.ts"),
  "utf8",
);
for (const requiredRecordingDeadlineEnforcement of [
  "recordingUploadAuthorizationExpiresAt",
  "policy: recordingProvider.uploadAuthorizationPolicy",
  "prepareRoomCompositeRecording",
  '"upload_authorization_window_unsupported"',
]) {
  if (!eventVirtualRoomServer.includes(requiredRecordingDeadlineEnforcement))
    failures.push(
      `The recording upload deadline policy is not enforced: ${requiredRecordingDeadlineEnforcement}`,
    );
}
const recordingPreparationIndex = eventVirtualRoomServer.indexOf(
  "await recordingProvider.prepareRoomCompositeRecording",
);
const recordingDispatchFenceIndex = eventVirtualRoomServer.indexOf(
  "const dispatchDecision = await beginRecordingStartDispatch",
);
const recordingProviderDispatchIndex = eventVirtualRoomServer.indexOf(
  "await preparedStart.dispatch()",
);
if (
  recordingPreparationIndex < 0 ||
  recordingDispatchFenceIndex <= recordingPreparationIndex ||
  recordingProviderDispatchIndex <= recordingDispatchFenceIndex
)
  failures.push(
    "Recording upload authorization must complete before the durable fence and LiveKit dispatch",
  );
const recordingDispatchBoundary = eventVirtualRoomServer.slice(
  eventVirtualRoomServer.indexOf("async function beginRecordingStartDispatch"),
  eventVirtualRoomServer.indexOf("async function failRecordingBeforeStart"),
);
for (const requiredDispatchRevalidation of [
  'select(["doorState", "endedAt", "replacedAt"])',
  '"eventSessionId"',
  '"roomGeneration"',
  ".forUpdate()",
  'room.doorState === "ended" || room.replacedAt',
  "const terminalAt = laterDate(",
  'failureCode: "meeting_ended_before_recording_started"',
]) {
  if (!recordingDispatchBoundary.includes(requiredDispatchRevalidation))
    failures.push(
      `The recording dispatch fence is missing terminal-state revalidation: ${requiredDispatchRevalidation}`,
    );
}
for (const requiredStopReconciliation of [
  "await recordingProvider.getRoomCompositeRecording({",
  'const stopRequired = ["starting", "active"].includes(',
  "async function beginRecordingStopDispatch(",
  "operation.recordingStopDispatchedAt",
  "recordingStopOutcomeUnknownAt",
  ".set({ recordingStopDispatchedAt: now })",
  "async function retryAmbiguousRecordingStop(",
  "recordingStopOutcomeUnknownAt: dispatchedAt",
  "claimed.recordingStopOutcomeUnknownAt",
  "claimed.recordingStopDispatchedAt",
  '"recording_stop_dispatch_pending"',
  "const stopSnapshot =",
  "recording.stopRequestedAt === null ? stopDispatchedAt : null",
  "stopSnapshot,\n      stopDispatchedAt,",
  '"recording_stop_outcome_unknown"',
  'lastErrorCode: "recording_stop_pending"',
]) {
  if (!eventVirtualRoomServer.includes(requiredStopReconciliation))
    failures.push(
      `Recording stop completion is not durably reconciled: ${requiredStopReconciliation}`,
    );
}
for (const requiredTerminalStartReconciliation of [
  "RECORDING_START_RECONCILIATION_MILLISECONDS",
  "now.getTime() - claimed.recordingStartDispatchedAt.getTime()",
  '"meeting_ended_before_recording_started"',
  '.where("kind", "=", "stop_recording")',
  '.where("recordingId", "=", claimed.recordingId)',
]) {
  if (!eventVirtualRoomServer.includes(requiredTerminalStartReconciliation))
    failures.push(
      `Terminal recording-start reconciliation is incomplete: ${requiredTerminalStartReconciliation}`,
    );
}
for (const requiredRecordingAuditBoundary of [
  'action: "event_virtual_recording.requested"',
  'action: "event_virtual_recording.started"',
  'action: "event_virtual_recording.stop_requested"',
  'action: "event_virtual_recording.stop_started"',
  'action: "event_virtual_recording.completed"',
  'action: "event_virtual_recording.failed"',
  'subjectType: "event_virtual_recording"',
  "const status = snapshot.status",
  'snapshot.status === "stopping"',
  '"recording_start_pending"',
]) {
  if (!eventVirtualRoomServer.includes(requiredRecordingAuditBoundary))
    failures.push(
      `The recording lifecycle is missing durable state or audit handling: ${requiredRecordingAuditBoundary}`,
    );
}
const virtualSessionOperationsBoundary = eventVirtualRoomServer.slice(
  eventVirtualRoomServer.indexOf(
    "export async function findEventVirtualSessionOperations",
  ),
  eventVirtualRoomServer.indexOf(
    "export async function ensureEventVirtualRoomForStaff",
  ),
);
for (const requiredPresenterNoticeBoundary of [
  '"session.livekitRecordingMode"',
  '"session.livekitPresenterRecordingNotice"',
  "presenterRecordingNotice:",
  'session.livekitRecordingMode === "automatic"',
]) {
  if (
    !virtualSessionOperationsBoundary.includes(requiredPresenterNoticeBoundary)
  )
    failures.push(
      `The operations workspace does not expose the immutable presenter recording notice: ${requiredPresenterNoticeBoundary}`,
    );
}
for (const requiredRecordingOperationsBoundary of [
  "findRecordingOperationsByRoom",
  '"recording.status"',
  '"operation.lastErrorCode"',
  "recordings: recordingsBySession.get(session.id)",
  "recording: recordingByRoom.get(access.roomId)",
]) {
  if (!eventVirtualRoomServer.includes(requiredRecordingOperationsBoundary))
    failures.push(
      `The staff workspace does not expose safe recording lifecycle and retry state: ${requiredRecordingOperationsBoundary}`,
    );
}
const virtualSessionOperationsUi = fs.readFileSync(
  path.join(
    root,
    "src/features/event-operations/EventOperationsVirtualSessions.tsx",
  ),
  "utf8",
);
const presenterRoomUi = fs.readFileSync(
  path.join(root, "src/features/event-operations/LiveKitPresenterRoom.tsx"),
  "utf8",
);
if (
  !virtualSessionOperationsUi.includes("presenterRecordingNotice={") ||
  !virtualSessionOperationsUi.includes(
    "virtualSession.presenterRecordingNotice",
  ) ||
  !presenterRoomUi.includes('title="Recording notice"') ||
  presenterRoomUi.indexOf('title="Recording notice"') >
    presenterRoomUi.indexOf('phase === "idle" ? "Enter green room"')
)
  failures.push(
    "The immutable presenter recording notice must remain visible before green-room credential issuance",
  );
const lobbyQueueUi = fs.readFileSync(
  path.join(
    root,
    "src/features/event-operations/EventOperationsLobbyQueue.tsx",
  ),
  "utf8",
);
for (const requiredRecordingWarning of [
  "queue?.recording ?? session.recording",
  'role="alert"',
  "recordingWarning",
]) {
  if (!lobbyQueueUi.includes(requiredRecordingWarning))
    failures.push(
      `The webinar operations UI does not surface recording failures and retries to staff: ${requiredRecordingWarning}`,
    );
}
const attendeeLobbyUi = fs.readFileSync(
  path.join(root, "src/routes/webinars.$publicReference.tsx"),
  "utf8",
);
const attendeeRecordingNoticeUi = fs.readFileSync(
  path.join(root, "src/features/event-lobby/AttendeeRecordingNotice.tsx"),
  "utf8",
);
if (
  !attendeeLobbyUi.includes("data.recording.enabled &&") ||
  !attendeeLobbyUi.includes("data.recording.acknowledged") ||
  !attendeeLobbyUi.includes("<AttendeeRecordingNotice") ||
  attendeeLobbyUi.indexOf("<AttendeeRecordingNotice") >
    attendeeLobbyUi.indexOf("<LiveKitAttendeeRoom") ||
  !attendeeRecordingNoticeUi.includes('title="Recording notice"')
)
  failures.push(
    "The acknowledged attendee recording notice must remain visible before and throughout the webinar connection",
  );
const scheduledEventsUi = fs.readFileSync(
  path.join(root, "src/routes/admin.events.scheduled.tsx"),
  "utf8",
);
for (const requiredPublicationGuidance of [
  "Use manual attendance",
  "shorten the presenter preparation window",
  "shorten the session",
  "disable automatic recording",
]) {
  if (!scheduledEventsUi.includes(requiredPublicationGuidance))
    failures.push(
      `LiveKit publication guidance is missing an applicable policy correction: ${requiredPublicationGuidance}`,
    );
}
const cloudRecordingProvider = fs.readFileSync(
  path.join(
    root,
    "src/server/livekit/livekit-recording-provider.cloud.server.ts",
  ),
  "utf8",
);
const exactStartListingBoundary = cloudRecordingProvider.slice(
  cloudRecordingProvider.indexOf("async listRoomCompositeRecordings"),
  cloudRecordingProvider.indexOf("async getRoomCompositeRecording"),
);
for (const requiredExactStartReconciliationBoundary of [
  "targetsStorageObjectKey",
  ".flatMap(",
  "parsedStorageObjectKey",
  "normalizeLiveKitRecordingEgressInfo(",
]) {
  if (
    !exactStartListingBoundary.includes(
      requiredExactStartReconciliationBoundary,
    )
  )
    failures.push(
      `Recording start reconciliation does not filter raw provider results by exact storage target: ${requiredExactStartReconciliationBoundary}`,
    );
}
if (
  exactStartListingBoundary.indexOf("targetsStorageObjectKey") >
  exactStartListingBoundary.indexOf("normalizeLiveKitRecordingEgressInfo(")
)
  failures.push(
    "Recording start reconciliation must filter raw provider results before normalisation",
  );
const adminEventOccurrenceServer = fs.readFileSync(
  path.join(root, "src/server/admin/admin-event-occurrence.server.ts"),
  "utf8",
);
for (const requiredRecordingPublicationBoundary of [
  "createConfiguredLiveKitRecordingProvider()",
  "liveKitAutomaticRecordingSessions",
  "!liveKitRecordingProvider",
  "supportsAutomaticRecordingSessionWindow",
  "livekitPresenterPreparationMinutes",
  "liveKitRecordingProvider.uploadAuthorizationPolicy",
]) {
  if (
    !adminEventOccurrenceServer.includes(requiredRecordingPublicationBoundary)
  )
    failures.push(
      `Automatic recording publication is missing provider availability enforcement: ${requiredRecordingPublicationBoundary}`,
    );
}
const adminEventTemplateServer = fs.readFileSync(
  path.join(root, "src/server/admin/admin-event-template.server.ts"),
  "utf8",
);
for (const requiredRecordingDurationEnforcement of [
  "recordingUploadAuthorizationPolicyForEnvironment(getServerEnv().APP_ENV)",
  "supportsAutomaticRecordingDurations(draft, recordingAuthorizationPolicy)",
  "maximumAutomaticRecordingWindowMinutes",
  "sessions.\"livekitRecordingMode\" = 'automatic'",
  '+ sessions."livekitPresenterPreparationMinutes"',
  "structure.unsupportedAutomaticRecordings > 0",
]) {
  if (!adminEventTemplateServer.includes(requiredRecordingDurationEnforcement))
    failures.push(
      `The automatic recording duration policy is not enforced: ${requiredRecordingDurationEnforcement}`,
    );
}
const accessGrantsStack = fs.readFileSync(
  path.join(root, "deploy/cdk/lib/access-grants-stack.ts"),
  "utf8",
);
for (const requiredAccessGrantsInfrastructureBoundary of [
  '"access-grants.s3.amazonaws.com"',
  '"aws:SourceAccount": this.account',
  '"aws:SourceArn": props.accessGrantsInstanceArn',
  'actions: ["sts:SetSourceIdentity"]',
  'actions: ["s3:GetDataAccess"]',
  "maxSessionDuration: Duration.hours(12)",
  'permission: "WRITE"',
  'granteeType: "IAM"',
  "LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID",
  "instance.applyRemovalPolicy(RemovalPolicy.RETAIN)",
]) {
  if (
    !`${applicationStack}\n${accessGrantsStack}`.includes(
      requiredAccessGrantsInfrastructureBoundary,
    )
  )
    failures.push(
      `The S3 Access Grants recording boundary is missing: ${requiredAccessGrantsInfrastructureBoundary}`,
    );
}
if (packageJson.dependencies["@aws-sdk/client-s3-control"] !== "3.1106.0")
  failures.push("The S3 Control client must remain exact-pinned");
for (const relative of [
  ".env.example",
  "deploy/cdk/lib/application-stack.ts",
  "src/server/runtime-environment.ts",
]) {
  if (
    !fs
      .readFileSync(path.join(root, relative), "utf8")
      .includes("LIVEKIT_ENABLED")
  )
    failures.push(`LiveKit enablement must remain explicit: ${relative}`);
}
const liveKitProvider = fs.readFileSync(
  path.join(root, "src/server/livekit/livekit-provider.server.ts"),
  "utf8",
);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  'from "livekit-server-sdk"',
  "LIVEKIT_JOIN_TOKEN_TTL_SECONDS = 5 * 60",
  "canPublishData: false",
  "pg_advisory_xact_lock",
  "this.coordinateRoomCreation",
])
  if (!liveKitProvider.includes(boundary))
    failures.push(`LiveKit provider boundary is missing: ${boundary}`);
const liveKitRecordingProvider = fs.readFileSync(
  path.join(
    root,
    "src/server/livekit/livekit-recording-provider.cloud.server.ts",
  ),
  "utf8",
);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  "new StartEgressRequest",
  "disableManifest: true",
  "uploadAuthorizationExpiresAt",
  "sessionToken: authorization.sessionToken",
])
  if (!liveKitRecordingProvider.includes(boundary))
    failures.push(`LiveKit recording boundary is missing: ${boundary}`);
const liveKitWebhook = fs.readFileSync(
  path.join(root, "src/server/livekit/livekit-webhook.server.ts"),
  "utf8",
);
const liveKitWebhookRoute = fs.readFileSync(
  path.join(root, "src/routes/api.livekit.webhook.ts"),
  "utf8",
);
for (const boundary of [
  "new WebhookReceiver",
  ".receive(rawBody, authorization)",
  "liveKitWebhookPayloadSchema.parse",
  'createHash("sha256").update(payload).digest("hex")',
  "egressInfo: decoded.egressInfo",
])
  if (!liveKitWebhook.includes(boundary))
    failures.push(`LiveKit webhook verification is missing: ${boundary}`);
const liveKitRecordingWebhook = fs.readFileSync(
  path.join(root, "src/server/livekit/livekit-recording-webhook.server.ts"),
  "utf8",
);
const liveKitRecordingWebhookMigration = fs.readFileSync(
  path.join(
    root,
    "src/server/db/migrations/0105_livekit_recording_webhook_receipts.ts",
  ),
  "utf8",
);
const liveKitRecordingReceiptConsumer = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-receipts.server.ts",
  ),
  "utf8",
);
const liveKitRecordingDownload = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-download.server.ts",
  ),
  "utf8",
);
const liveKitRecordingAccess = fs.readFileSync(
  path.join(root, "src/server/events/event-virtual-recording-access.server.ts"),
  "utf8",
);
const liveKitRecordingPlayback = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-playback.server.ts",
  ),
  "utf8",
);
const liveKitRecordingPlaybackRoute = fs.readFileSync(
  path.join(root, "src/routes/api.play.$recordingId.ts"),
  "utf8",
);
const liveKitRecordingPlaybackResponse = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-playback-response.server.ts",
  ),
  "utf8",
);
const liveKitRecordingDownloadResponse = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-download-response.server.ts",
  ),
  "utf8",
);
const liveKitRecordingStreamResponse = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-stream-response.server.ts",
  ),
  "utf8",
);
const liveKitRecordingPlaybackMigration = fs.readFileSync(
  path.join(
    root,
    "src/server/db/migrations/0108_livekit_recording_playback_audit.ts",
  ),
  "utf8",
);
const liveKitRecordingRetention = fs.readFileSync(
  path.join(
    root,
    "src/server/events/event-virtual-recording-retention.server.ts",
  ),
  "utf8",
);
const liveKitRecordingRetentionMigration = fs.readFileSync(
  path.join(
    root,
    "src/server/db/migrations/0109_livekit_recording_retention.ts",
  ),
  "utf8",
);
const objectStorage = fs.readFileSync(
  path.join(root, "src/server/storage/object-storage.server.ts"),
  "utf8",
);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  'insertInto("livekit_webhook_receipt")',
  '.columns(["providerEnvironment", "providerEventId"])',
  "environment.LIVEKIT_PROJECT_ENVIRONMENT !== event.providerEnvironment",
  'where("room.providerRoomName", "=", roomName)',
  "normalizeLiveKitRecordingEgressInfo",
  'processingState: "pending"',
])
  if (!liveKitRecordingWebhook.includes(boundary))
    failures.push(`LiveKit recording receipt boundary is missing: ${boundary}`);
if (liveKitRecordingWebhook.includes("rawBody"))
  failures.push(
    "LiveKit recording receipts must not retain raw webhook bodies",
  );
for (const boundary of [
  "guard_livekit_webhook_receipt_evidence",
  "Webhook receipt identity evidence is immutable",
  "Webhook receipt normalized evidence is immutable",
  "livekit_webhook_receipt_guard_trg",
  "revoke delete on table livekit_webhook_receipt",
])
  if (!liveKitRecordingWebhookMigration.includes(boundary))
    failures.push(`LiveKit receipt evidence guard is missing: ${boundary}`);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  ".forUpdate()",
  ".skipLocked()",
  'processingState: "processing"',
  'processingState: "processed"',
  'processingState: "failed"',
  "recording_receipt_identity_conflict",
  "effectiveStartedAt",
  "datesContradict",
  "terminalReceiptConflict",
  "const stopOperation = await transaction",
  "recording.fileSizeBytes !== receipt.fileSizeBytes",
  "recording.durationNanoseconds !== receipt.durationNanoseconds",
  'evidenceSource: "livekit_webhook"',
  "RECEIPT_MAXIMUM_ATTEMPTS",
])
  if (!liveKitRecordingReceiptConsumer.includes(boundary))
    failures.push(`LiveKit receipt consumer is missing: ${boundary}`);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  'selectFrom("platform_admin")',
  'recording.status !== "complete"',
  "recording.retentionDeadline <= now",
  '.where("session.eventOccurrenceId", "=", input.eventOccurrenceId)',
])
  if (!liveKitRecordingAccess.includes(boundary))
    failures.push(`LiveKit recording access boundary is missing: ${boundary}`);
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  "findEventVirtualRecordingAccess",
  "RECORDING_DOWNLOAD_EXPIRY_SECONDS = 60",
  'createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)',
  "timingSafeEqual",
  'accessMode: "application_download"',
  "url = `/api/play/",
  "accessEventVirtualRecordingDownload",
  "isEventVirtualRecordingDownloadActive",
  'action: "event_virtual_recording.download_issued"',
])
  if (!liveKitRecordingDownload.includes(boundary))
    failures.push(
      `LiveKit recording download boundary is missing: ${boundary}`,
    );
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  'insertInto("event_virtual_recording_playback_session")',
  'action: "event_virtual_recording.playback_issued"',
  'where("recordingId", "=", recording.id)',
  'where("userId", "=", user.id)',
  ".forUpdate()",
  "session.expiresAt <= now",
  "findEventVirtualRecordingAccess",
  "isEventVirtualRecordingPlaybackActive",
  '"update"',
])
  if (!liveKitRecordingPlayback.includes(boundary))
    failures.push(
      `LiveKit recording playback boundary is missing: ${boundary}`,
    );
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  'selectFrom("platform_admin")',
  '.where("session.eventOccurrenceId", "=", input.eventOccurrenceId)',
  'insertInto("event_virtual_recording_deletion")',
  "revokeCompletedRecordingAccess",
  'status: "deleted"',
  'deleteFrom("event_virtual_recording_playback_session")',
  "DELETION_MAXIMUM_AUTOMATIC_ATTEMPTS",
  'deletion.status === "processing"',
  'lastErrorCode: "recording_deletion_lease_expired"',
  "deleteVersionedObject",
  'action: "event_virtual_recording.deletion_requested"',
  'action: "event_virtual_recording.deleted"',
])
  if (!liveKitRecordingRetention.includes(boundary))
    failures.push(
      `LiveKit recording retention boundary is missing: ${boundary}`,
    );
for (const boundary of [
  "guard_event_virtual_recording_deletion",
  "Recording deletion request evidence is immutable",
  "Completed recording deletion evidence is immutable",
  "event_virtual_recording_deletion_guard_trg",
  "revoke delete on table event_virtual_recording_deletion",
])
  if (!liveKitRecordingRetentionMigration.includes(boundary))
    failures.push(
      `LiveKit recording deletion evidence guard is missing: ${boundary}`,
    );
for (const boundary of [
  "ListObjectVersionsCommand",
  ".filter(({ Key, VersionId }) => Key === key && Boolean(VersionId))",
  "deletion.Errors?.length",
])
  if (!objectStorage.includes(boundary))
    failures.push(
      `Recording version deletion boundary is missing: ${boundary}`,
    );
for (const boundary of [
  "handleEventVirtualRecordingPlaybackRequest",
  "handleEventVirtualRecordingDownloadRequest",
  'searchParams.has("download")',
  "params.recordingId",
])
  if (!liveKitRecordingPlaybackRoute.includes(boundary))
    failures.push(
      `LiveKit recording playback route boundary is missing: ${boundary}`,
    );
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  "eventVirtualRecordingDownloadSchema.safeParse({",
  "searchParams.get(",
  "getRequestUser()",
  "accessEventVirtualRecordingPlayback",
  "parseByteRange",
  "boundByteRange",
  "MAXIMUM_PLAYBACK_RANGE_BYTES",
  "limitRecordingStreamToAuthorization",
  "isEventVirtualRecordingPlaybackActive",
  "access.target.expiresAt",
  "getObjectStream",
  'headers.set("Content-Range", object.contentRange)',
  '"Cache-Control": "private, no-store"',
  '"Referrer-Policy": "no-referrer"',
])
  if (!liveKitRecordingPlaybackResponse.includes(boundary))
    failures.push(
      `LiveKit recording playback response boundary is missing: ${boundary}`,
    );
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  "eventVirtualRecordingDownloadAccessSchema.safeParse({",
  'searchParams.get("download")',
  "getRequestUser()",
  "accessEventVirtualRecordingDownload",
  "isEventVirtualRecordingDownloadActive",
  "limitRecordingStreamToAuthorization",
  "getObjectStream",
  'headers.set("Content-Range", object.contentRange)',
  'attachment; filename="webinar-recording.mp4"',
  '"Cache-Control": "private, no-store"',
  '"Referrer-Policy": "no-referrer"',
])
  if (!liveKitRecordingDownloadResponse.includes(boundary))
    failures.push(
      `LiveKit recording download response boundary is missing: ${boundary}`,
    );
for (const boundary of [
  'import "@tanstack/react-start/server-only"',
  "isAuthorized()",
  "void reader.cancel(reason)",
  "Recording authorization revoked",
  "Recording authorization expired",
])
  if (!liveKitRecordingStreamResponse.includes(boundary))
    failures.push(
      `LiveKit recording stream revocation boundary is missing: ${boundary}`,
    );
for (const boundary of [
  "create table event_virtual_recording_playback_session",
  'primary key ("recordingId", "userId")',
  "references event_virtual_recording(id) on delete restrict",
  'references "user"(id) on delete restrict',
  "event_virtual_recording_playback_timeline_ck",
  "event_virtual_recording_playback_expiry_idx",
])
  if (!liveKitRecordingPlaybackMigration.includes(boundary))
    failures.push(
      `LiveKit recording playback migration boundary is missing: ${boundary}`,
    );
for (const relative of [
  "src/worker/scorm-worker.ts",
  "src/worker/scorm-worker-iteration.ts",
])
  if (
    !fs
      .readFileSync(path.join(root, relative), "utf8")
      .includes("processAvailableLiveKitRecordingReceipts")
  )
    failures.push(`LiveKit receipt processing is not scheduled by ${relative}`);
const workerIteration = fs.readFileSync(
  path.join(root, "src/worker/scorm-worker-iteration.ts"),
  "utf8",
);
if (!workerIteration.includes("liveKitRecordingReceipts.limitReached"))
  failures.push(
    "LiveKit provider reconciliation must wait while the receipt batch is full",
  );
for (const boundary of [
  '"application/webhook+json"',
  "request.arrayBuffer()",
  "MAX_WEBHOOK_BYTES",
  "ingestVerifiedLiveKitRecordingWebhook(event)",
  '"webhook_ingestion_not_ready"',
])
  if (!liveKitWebhookRoute.includes(boundary))
    failures.push(`LiveKit webhook route boundary is missing: ${boundary}`);
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
const environmentRefresh = fs.readFileSync(
  path.join(root, "deploy/scripts/upskill-refresh-env.sh"),
  "utf8",
);
const stagingReset = fs.readFileSync(
  path.join(root, "deploy/scripts/reset-and-seed-staging.sh"),
  "utf8",
);
const stagingResetDatabase = fs.readFileSync(
  path.join(root, "scripts/reset-staging-database.ts"),
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
if (
  !provisionRuntimeRoles.includes(
    "revoke delete on table event_virtual_recording from ${role}",
  )
)
  failures.push(
    "Runtime database roles must not physically delete LiveKit recording evidence",
  );
if (
  !provisionRuntimeRoles.includes(
    "revoke delete on table event_virtual_recording_deletion from ${role}",
  )
)
  failures.push(
    "Runtime database roles must not physically delete LiveKit recording deletion evidence",
  );
if (
  !provisionRuntimeRoles.includes(
    "revoke delete on table livekit_webhook_receipt from ${role}",
  )
)
  failures.push(
    "Runtime database roles must not physically delete LiveKit webhook receipts",
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
  "--retry-connrefused",
  "Refreshed configuration for active release",
  "Restored previous configuration after active-release refresh failure",
  "Previous configuration restore failed readiness",
  "Active-release configuration refresh failed validation",
  "Active-release configuration refresh failed readiness",
  "Release failed readiness checks and was rolled back",
  "/usr/local/sbin/upskill-bootstrap-platform-admin",
  "/usr/local/sbin/upskill-invite-platform-admin",
  "/usr/local/sbin/upskill-reset-and-seed-staging",
])
  if (!installRelease.includes(invariant))
    failures.push(`Release installation safety is missing: ${invariant}`);
for (const invariant of [
  "I_UNDERSTAND_THIS_DELETES_ALL_STAGING_DATA",
  "APP_ENV=staging",
  "STAGING_RESET_DATABASE_TARGET",
  "flock -n",
  "systemctl stop upskill-web upskill-worker",
  "services remain stopped",
  "scripts/reset-staging-database.ts --validate-only",
  "src/server/db/provision-runtime-roles.ts",
  "scripts/seed-current-snapshot.ts",
  "api/ready?deploymentId=${release_sha}",
])
  if (
    !stagingReset.includes(invariant) &&
    !stagingResetDatabase.includes(invariant)
  )
    failures.push(`Staging reset safety is missing: ${invariant}`);
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
const releaseWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/release.yml"),
  "utf8",
);
const ciWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/ci.yml"),
  "utf8",
);
for (const invariant of [
  "actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830",
  "path: ~/.cache/ms-playwright",
  "steps.playwright-version.outputs.version",
])
  if (!ciWorkflow.includes(invariant))
    failures.push(`Browser cache configuration is missing: ${invariant}`);
const playwrightCacheIndex = ciWorkflow.indexOf("actions/cache@");
const playwrightInstallIndex = ciWorkflow.indexOf(
  "pnpm exec playwright install --with-deps",
);
if (
  playwrightCacheIndex < 0 ||
  playwrightInstallIndex < 0 ||
  playwrightCacheIndex > playwrightInstallIndex
)
  failures.push("Playwright browsers must be restored before installation");
for (const [name, workflow] of [
  ["CI", ciWorkflow],
  ["release", releaseWorkflow],
  ["deployment", deployWorkflow],
])
  if (!workflow.includes("fetch-depth: 0"))
    failures.push(`${name} verification must fetch the migration baseline tag`);
for (const invariant of [
  'GITHUB_REF" != "refs/heads/main',
  "latest-successful",
  "actions: read",
  "attestations: read",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "gh attestation verify",
  "UPSKILL_EXPECTED_RELEASE_SHA: ${{ steps.release.outputs.release_sha }}",
  "staging_data:",
  "default: preserve",
  "reset-and-seed",
  "sudo /usr/local/sbin/upskill-reset-and-seed-staging",
])
  if (!deployWorkflow.includes(invariant))
    failures.push(`Deployment authorization is missing: ${invariant}`);
for (const invariant of [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.head_branch == 'main'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_repository.full_name == github.repository",
  "attestations: write",
  "artifact-metadata: write",
  "id-token: write",
  "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "UPSKILL_RELEASE_ARTIFACT: artifacts/upskill-${{ env.RELEASE_SHA }}.tar.gz",
  "subject-path: artifacts/upskill-${{ env.RELEASE_SHA }}.tar.gz",
])
  if (!releaseWorkflow.includes(invariant))
    failures.push(`Release authorization is missing: ${invariant}`);
const attestationIndex = releaseWorkflow.indexOf("actions/attest@");
const artifactRetentionIndex = releaseWorkflow.indexOf(
  "actions/upload-artifact@",
);
if (
  attestationIndex < 0 ||
  artifactRetentionIndex < 0 ||
  attestationIndex > artifactRetentionIndex
)
  failures.push("The release artifact must be attested before retention");
const provenanceVerificationIndex = deployWorkflow.indexOf(
  "gh attestation verify",
);
const artifactUploadIndex = deployWorkflow.indexOf(
  'aws s3 cp "$RELEASE_ARTIFACT"',
);
if (
  provenanceVerificationIndex < 0 ||
  artifactUploadIndex < 0 ||
  provenanceVerificationIndex > artifactUploadIndex
)
  failures.push("Signed release provenance must be verified before S3 upload");
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
const environmentRefreshInstallIndex = installRelease.indexOf(
  '"$staging_path/deploy/scripts/upskill-refresh-env.sh"',
);
const environmentRefreshInvocationIndex = installRelease.indexOf(
  "if ! /usr/local/bin/upskill-refresh-env",
);
if (
  environmentRefreshInstallIndex < 0 ||
  environmentRefreshInvocationIndex < 0 ||
  environmentRefreshInstallIndex > environmentRefreshInvocationIndex
)
  failures.push(
    "Release installation must install the versioned environment refresh helper before using it",
  );
for (const invariant of [
  'secret-id "${secret_prefix}/livekit"',
  "aws ssm get-parameter",
  "if ! recording_upload_role_arn=",
  'if [[ -n "$recording_upload_role_arn" ]]',
  "/livekit/recording-upload-role-arn",
  "LIVEKIT_RECORDING_UPLOAD_ROLE_ARN",
  "if ! recording_access_grants_account_id=",
  'if [[ -n "$recording_access_grants_account_id" ]]',
  "/livekit/recording-access-grants-account-id",
  "LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID",
  'LIVEKIT_ENABLED" or .key == "LIVEKIT_PROJECT_ENVIRONMENT',
  "upskill-web.env",
  "upskill-worker.env",
  "upskill-deploy.env",
])
  if (!environmentRefresh.includes(invariant))
    failures.push(`Environment refresh safety is missing: ${invariant}`);
if (
  /^recording_upload_role_arn=\$\(aws ssm get-parameter/mu.test(
    environmentRefresh,
  )
)
  failures.push(
    "The dormant recording upload role lookup must not block application-only release rollout",
  );
if (
  /^recording_access_grants_account_id=\$\(aws ssm get-parameter/mu.test(
    environmentRefresh,
  )
)
  failures.push(
    "The Access Grants account lookup must not block application-only release rollout",
  );
const deploymentIdentity = fs.readFileSync(
  path.join(root, "deploy/cdk/lib/deployment-identity-stack.ts"),
  "utf8",
);
if (applicationStack.includes("userDataCausesReplacement: true"))
  failures.push(
    "Single-host user-data changes must not replace EC2 without coordinated release and TLS restoration",
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
const inviteAdministrator = fs.readFileSync(
  path.join(root, "scripts/invite-platform-admin.mjs"),
  "utf8",
);
for (const invariant of [
  "pg_advisory_xact_lock",
  "Platform administration is already configured; invitation is permanently disabled",
  "MIGRATION_DATABASE_URL is required to invite a deployed administrator",
  "reset-password:",
  "notification.delivery_requested",
  "first_environment_bootstrap",
])
  if (!inviteAdministrator.includes(invariant))
    failures.push(
      `Platform-administrator invitation boundary is missing: ${invariant}`,
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
