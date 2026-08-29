import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";
import { encryptAccessCode } from "#/server/access/access-code-encryption.server";
import { issueAccessCode } from "#/server/access/access-code.server";
import { getServerEnv } from "#/server/env.server";
import {
  objectExists,
  putObject,
} from "#/server/storage/object-storage.server";

type Row = Record<string, unknown>;
interface Tables extends Record<string, Array<Row>> {
  access_grant: Array<Row>;
  access_grant_code: Array<Row>;
  account: Array<Row>;
  course_version_item: Array<Row>;
  email_design: Array<Row>;
  enterprise_contract: Array<Row>;
  enterprise_contract_code: Array<Row>;
  enterprise_contract_course_coverage: Array<Row>;
  enterprise_contract_employee_eligibility: Array<Row>;
  enterprise_contract_event_coverage: Array<Row>;
  enterprise_contract_owner_assignment: Array<Row>;
  event_survey_access: Array<Row>;
  event_template_version_item: Array<Row>;
  learning_activity: Array<Row>;
  learning_activity_version: Array<Row>;
  onboarding_response: Array<Row>;
  phone_verification_claim: Array<Row>;
  scorm_package_version: Array<Row>;
  user: Array<Row>;
}

interface SnapshotFixture {
  fixtureVersion: number;
  sourceDescription: string;
  tables: Tables;
}

interface SeedCurrentSnapshotOptions {
  provisionExternalAssets?: boolean;
}

const fixturePath = new URL(
  "./fixtures/current-development-snapshot.json",
  import.meta.url,
);
const appEnvironment = process.env.APP_ENV ?? "development";
const seedPassword = process.env.SEED_LEARNER_PASSWORD ?? "";
const assetsDirectory = path.resolve(
  process.env.SEED_ASSET_DIRECTORY ?? ".local/current-seed-assets",
);
const stagingConfirmation = process.env.ALLOW_STAGING_SEED;
const smsTestPhone = process.env.SEED_SMS_TEST_PHONE?.trim();
const smsTestEmail = (
  process.env.SEED_SMS_TEST_USER_EMAIL ?? "learner4@codestudio.au"
).toLocaleLowerCase("en-AU");

function validateExecutionBoundary(databaseUrl: string): void {
  if (appEnvironment === "production")
    throw new Error("Snapshot seeding is prohibited in production");
  if (appEnvironment === "staging") {
    if (stagingConfirmation !== "I_UNDERSTAND_THIS_ADDS_FIXTURE_DATA")
      throw new Error(
        "Staging seeding requires ALLOW_STAGING_SEED=I_UNDERSTAND_THIS_ADDS_FIXTURE_DATA",
      );
  } else if (appEnvironment !== "development" && appEnvironment !== "test") {
    throw new Error(
      "Snapshot seeding supports development, test, or staging only",
    );
  }
  if (appEnvironment !== "staging") {
    const hostname = new URL(databaseUrl).hostname;
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname))
      throw new Error("Development snapshot seeding requires a local database");
  }
  if (seedPassword.length < 12)
    throw new Error(
      "SEED_LEARNER_PASSWORD must contain at least 12 characters",
    );
  if (smsTestPhone && appEnvironment !== "staging")
    throw new Error("SEED_SMS_TEST_PHONE is accepted in staging only");
  if (smsTestPhone && !/^\+61[2-478]\d{8}$/u.test(smsTestPhone))
    throw new Error("SEED_SMS_TEST_PHONE must be an Australian E.164 number");
}

function quotedIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value))
    throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseValue(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : value;
}

function normalizeSnapshotBaseVersions(fixture: SnapshotFixture): void {
  const versionedTables = [
    ["course_version", "courseId"],
    ["email_design_version", "emailDesignId"],
    ["event_template_version", "eventTemplateId"],
    ["learning_activity_version", "activityId"],
    ["onboarding_definition_version", "definitionId"],
  ] as const;
  for (const [table, aggregateKey] of versionedTables) {
    const aggregateIds = new Set<string>();
    fixture.tables[table] = (fixture.tables[table] ?? []).map((row) => {
      const aggregateId = String(row[aggregateKey]);
      if (aggregateIds.has(aggregateId))
        throw new Error(
          `Snapshot-only seed contains retained history for ${table} ${aggregateId}`,
        );
      aggregateIds.add(aggregateId);
      return { ...row, version: 1 };
    });
  }
}

function assertCurrentFeatureSamples(fixture: SnapshotFixture): void {
  const requiredTables = [
    "enterprise_contract",
    "enterprise_contract_code",
    "enterprise_contract_course_coverage",
    "enterprise_contract_employee_eligibility",
    "enterprise_contract_event_coverage",
    "enterprise_contract_owner_assignment",
  ] as const;
  for (const table of requiredTables)
    if (fixture.tables[table].length === 0)
      throw new Error(`Snapshot fixture has no sample data for ${table}`);
  const ownerIds = new Set(
    fixture.tables.enterprise_contract_owner_assignment.map((row) =>
      String(row.userId),
    ),
  );
  if (!fixture.tables.user.some((row) => ownerIds.has(String(row.id))))
    throw new Error(
      "Snapshot fixture has no enterprise contract owner account",
    );
}

async function insertRows(
  client: Client,
  table: string,
  rows: Array<Row>,
): Promise<void> {
  if (rows.length === 0) return;
  const firstRow = rows[0];
  assert.ok(firstRow);
  const columns = Object.keys(firstRow);
  for (const row of rows)
    assert.deepEqual(
      Object.keys(row).toSorted(),
      columns.toSorted(),
      `${table} rows have inconsistent columns`,
    );
  const values: Array<unknown> = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(databaseValue(row[column]));
      return `$${String(values.length)}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await client.query(
    `insert into ${quotedIdentifier(table)} (${columns
      .map(quotedIdentifier)
      .join(", ")}) values ${tuples.join(", ")}`,
    values,
  );
}

function replaceExactStrings(
  value: unknown,
  replacements: Map<string, string>,
): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value))
    return value.map((entry) => replaceExactStrings(entry, replacements));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceExactStrings(entry, replacements),
      ]),
    );
  return value;
}

function overlaySmsTestPhone(fixture: SnapshotFixture): void {
  if (!smsTestPhone) return;
  const target = fixture.tables.user.find(
    (row) => String(row.email).toLocaleLowerCase("en-AU") === smsTestEmail,
  );
  if (!target)
    throw new Error(`SMS test user ${smsTestEmail} is not in the fixture`);
  const previousPhone = target.phone;
  target.phone = smsTestPhone;
  target.smsEnabled = true;
  target.smsVerifiedAt = null;
  target.updatedAt = new Date().toISOString();
  if (typeof previousPhone === "string") {
    const replacement = new Map([[previousPhone, smsTestPhone]]);
    const targetAssignmentIds = new Set(
      (fixture.tables.onboarding_assignment ?? [])
        .filter((row) => row.userId === target.id)
        .map((row) => row.id),
    );
    fixture.tables.onboarding_response = fixture.tables.onboarding_response.map(
      (row) =>
        targetAssignmentIds.has(row.assignmentId)
          ? (replaceExactStrings(row, replacement) as Row)
          : row,
    );
  }
  fixture.tables.phone_verification_claim =
    fixture.tables.phone_verification_claim.filter(
      (row) => row.userId !== target.id && row.phone !== smsTestPhone,
    );
}

async function remapExistingUsers(
  client: Client,
  fixture: SnapshotFixture,
): Promise<void> {
  const emails = fixture.tables.user.map((row) => String(row.email));
  const existing = await client.query<{ id: string; email: string }>(
    `select id, email from "user" where lower(email) = any($1::text[])`,
    [emails.map((email) => email.toLocaleLowerCase("en-AU"))],
  );
  const fixtureByEmail = new Map(
    fixture.tables.user.map((row) => [
      String(row.email).toLocaleLowerCase("en-AU"),
      String(row.id),
    ]),
  );
  const replacements = new Map<string, string>();
  for (const row of existing.rows) {
    const fixtureId = fixtureByEmail.get(row.email.toLocaleLowerCase("en-AU"));
    if (fixtureId && fixtureId !== row.id) replacements.set(fixtureId, row.id);
  }
  if (replacements.size === 0) return;
  fixture.tables = Object.fromEntries(
    Object.entries(fixture.tables).map(([table, rows]) => [
      table,
      rows.map((row) => replaceExactStrings(row, replacements) as Row),
    ]),
  ) as Tables;
  const existingIds = new Set(existing.rows.map((row) => row.id));
  fixture.tables.user = fixture.tables.user.filter(
    (row) => !existingIds.has(String(row.id)),
  );
  fixture.tables.platform_admin = (fixture.tables.platform_admin ?? []).filter(
    (row) => !existingIds.has(String(row.userId)),
  );
}

async function fixtureAlreadyPresent(
  client: Client,
  fixture: SnapshotFixture,
): Promise<boolean> {
  const anchorIds = (fixture.tables.course ?? []).map((row) => String(row.id));
  if (anchorIds.length === 0) throw new Error("Fixture has no course anchors");
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from course where id = any($1::text[])`,
    [anchorIds],
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count === 0) return false;
  if (count !== anchorIds.length)
    throw new Error(
      "A partial snapshot fixture already exists; refusing an ambiguous seed",
    );
  return true;
}

async function preserveMigrationSeededEmailDesigns(
  client: Client,
  fixture: SnapshotFixture,
): Promise<void> {
  const designIds = fixture.tables.email_design.map((row) => String(row.id));
  const versionIds = (fixture.tables.email_design_version ?? []).map((row) =>
    String(row.id),
  );
  const [designs, versions] = await Promise.all([
    client.query<{ id: string }>(
      `select id from email_design where id = any($1::text[])`,
      [designIds],
    ),
    client.query<{ id: string }>(
      `select id from email_design_version where id = any($1::text[])`,
      [versionIds],
    ),
  ]);
  const existingDesignIds = new Set(designs.rows.map((row) => row.id));
  const existingVersionIds = new Set(versions.rows.map((row) => row.id));
  fixture.tables.email_design = fixture.tables.email_design.filter(
    (row) => !existingDesignIds.has(String(row.id)),
  );
  fixture.tables.email_design_version = (
    fixture.tables.email_design_version ?? []
  ).filter((row) => !existingVersionIds.has(String(row.id)));

  const occupiedPositions = await client.query<{
    contextKey: string;
    maximumPosition: number;
  }>(
    `select "contextKey", max(position)::integer as "maximumPosition"
       from email_design
      group by "contextKey"`,
  );
  const nextPositionByContext = new Map(
    occupiedPositions.rows.map((row) => [
      row.contextKey,
      row.maximumPosition + 1,
    ]),
  );
  const orderedFixtureDesigns = fixture.tables.email_design.toSorted(
    (left, right) =>
      String(left.contextKey).localeCompare(String(right.contextKey)) ||
      Number(left.position) - Number(right.position) ||
      String(left.id).localeCompare(String(right.id)),
  );
  const remappedPositions = new Map<string, number>();
  for (const row of orderedFixtureDesigns) {
    const contextKey = String(row.contextKey);
    const nextPosition = nextPositionByContext.get(contextKey);
    if (nextPosition === undefined) continue;
    remappedPositions.set(String(row.id), nextPosition);
    nextPositionByContext.set(contextKey, nextPosition + 1);
  }
  fixture.tables.email_design = fixture.tables.email_design.map((row) => ({
    ...row,
    position: remappedPositions.get(String(row.id)) ?? row.position,
  }));
}

async function regularFiles(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<string> = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(absolute)));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`Unsupported seed asset entry: ${absolute}`);
  }
  return files;
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLocaleLowerCase("en-AU");
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".ogv": "video/ogg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
  };
  return types[extension] ?? "application/octet-stream";
}

async function uploadAssets(fixture: SnapshotFixture): Promise<void> {
  const env = getServerEnv();
  const privateRoot = path.join(assetsDirectory, "private");
  for (const table of ["accreditation_logo_asset", "offering_image_asset"])
    for (const asset of fixture.tables[table] ?? []) {
      const objectKey = String(asset.objectKey);
      const filePath = path.resolve(privateRoot, objectKey);
      if (!filePath.startsWith(`${privateRoot}${path.sep}`))
        throw new Error(`Unsafe fixture asset key: ${objectKey}`);
      const bytes = await readFile(filePath);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (
        bytes.byteLength !== Number(asset.sourceBytes) ||
        digest !== asset.sha256
      )
        throw new Error(`Fixture asset integrity check failed: ${objectKey}`);
      try {
        if (!(await objectExists(env.S3_PRIVATE_RESOURCES_BUCKET, objectKey)))
          await putObject({
            Bucket: env.S3_PRIVATE_RESOURCES_BUCKET,
            Key: objectKey,
            Body: bytes,
            ContentLength: bytes.byteLength,
            ContentType: String(asset.mediaType),
            CacheControl: "private, no-store",
          });
      } catch (error) {
        throw new Error(`Could not upload private seed asset: ${objectKey}`, {
          cause: error,
        });
      }
    }

  const packageRow = fixture.tables.scorm_package_version[0];
  if (!packageRow) throw new Error("Fixture has no SCORM package version");
  const scormRoot = path.join(assetsDirectory, "scorm-source");
  const scormFiles = await regularFiles(scormRoot);
  const scormObjects = await Promise.all(
    scormFiles.map(async (filePath) => ({
      bytes: await readFile(filePath),
      filePath,
    })),
  );
  const manifest = packageRow.manifest as {
    expandedBytes: number;
    fileCount: number;
  };
  const expandedBytes = scormObjects.reduce(
    (total, file) => total + file.bytes.byteLength,
    0,
  );
  if (
    scormFiles.length !== manifest.fileCount ||
    expandedBytes !== manifest.expandedBytes
  )
    throw new Error("SCORM seed content does not match the fixture manifest");
  for (const { bytes, filePath } of scormObjects) {
    const relativePath = path
      .relative(scormRoot, filePath)
      .split(path.sep)
      .join("/");
    if (!relativePath || relativePath.startsWith("../"))
      throw new Error(`Unsafe SCORM seed path: ${relativePath}`);
    try {
      const objectKey = `${String(packageRow.contentPrefix)}/${relativePath}`;
      if (!(await objectExists(env.S3_LEARNING_CONTENT_BUCKET, objectKey)))
        await putObject({
          Bucket: env.S3_LEARNING_CONTENT_BUCKET,
          Key: objectKey,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: contentTypeFor(relativePath),
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: {
            "package-version-id": String(packageRow.id),
            "source-sha256": String(packageRow.sha256),
          },
        });
    } catch (error) {
      throw new Error(`Could not upload SCORM seed asset: ${relativePath}`, {
        cause: error,
      });
    }
  }
}

function verifyExternalAssetMetadata(fixture: SnapshotFixture): void {
  const sha256Pattern = /^[a-f0-9]{64}$/u;
  const safeObjectKey = (value: string) => {
    const normalized = path.posix.normalize(value);
    return (
      value.length > 0 &&
      !path.posix.isAbsolute(value) &&
      normalized !== "." &&
      normalized !== ".." &&
      !normalized.startsWith("../")
    );
  };
  for (const table of ["accreditation_logo_asset", "offering_image_asset"])
    for (const asset of fixture.tables[table] ?? []) {
      const objectKey = String(asset.objectKey);
      if (!safeObjectKey(objectKey))
        throw new Error(`Unsafe fixture asset key: ${objectKey}`);
      if (!sha256Pattern.test(String(asset.sha256)))
        throw new Error(`Invalid fixture asset digest: ${objectKey}`);
      if (
        !Number.isSafeInteger(asset.sourceBytes) ||
        Number(asset.sourceBytes) < 1
      )
        throw new Error(`Invalid fixture asset size: ${objectKey}`);
      if (!String(asset.mediaType).includes("/"))
        throw new Error(`Invalid fixture asset media type: ${objectKey}`);
    }

  const packageRow = fixture.tables.scorm_package_version[0];
  const manifest = packageRow?.manifest as
    { expandedBytes?: unknown; fileCount?: unknown } | undefined;
  if (
    !packageRow ||
    !sha256Pattern.test(String(packageRow.sha256)) ||
    !safeObjectKey(String(packageRow.contentPrefix)) ||
    !String(packageRow.contentPrefix).startsWith("scorm/") ||
    !Number.isSafeInteger(manifest?.fileCount) ||
    Number(manifest?.fileCount) < 1 ||
    !Number.isSafeInteger(manifest?.expandedBytes) ||
    Number(manifest?.expandedBytes) < 1
  )
    throw new Error("Invalid SCORM seed asset metadata");
}

function publicReference(index: number): string {
  const suffix = index.toString(36).padStart(5, "0");
  return `${randomBytes(20).toString("base64url").slice(0, 27)}${suffix}`;
}

function accessCodeLookupId(index: number): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let remaining = index + 1;
  let value = "";
  while (remaining > 0) {
    const character = alphabet.at(remaining % alphabet.length);
    assert.ok(character);
    value = `${character}${value}`;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return value.padStart(10, "2");
}

function prepareRuntimeRows(
  fixture: SnapshotFixture,
  passwordHash: string,
): void {
  const activityByVersion = new Map(
    fixture.tables.learning_activity_version.map((row) => [
      String(row.id),
      String(row.activityId),
    ]),
  );
  const courseSurveyIds = new Set(
    fixture.tables.course_version_item
      .filter((row) => row.kind === "survey")
      .map((row) =>
        activityByVersion.get(String(row.learningActivityVersionId)),
      )
      .filter((id): id is string => Boolean(id)),
  );
  const eventSurveyIds = new Set(
    fixture.tables.event_template_version_item
      .filter((row) => row.kind === "survey")
      .map((row) =>
        activityByVersion.get(String(row.learningActivityVersionId)),
      )
      .filter((id): id is string => Boolean(id)),
  );
  const positions = new Map<string, number>();
  fixture.tables.learning_activity = fixture.tables.learning_activity.map(
    (row) => {
      if (row.kind !== "survey")
        return { ...row, surveyType: null, surveyPosition: null };
      const id = String(row.id);
      const type =
        row.surveyUsage === "onboarding"
          ? "system"
          : courseSurveyIds.has(id) && eventSurveyIds.has(id)
            ? "shared"
            : eventSurveyIds.has(id)
              ? "event"
              : "elearning";
      const position = positions.get(type) ?? 0;
      positions.set(type, position + 1);
      return { ...row, surveyType: type, surveyPosition: position };
    },
  );
  fixture.tables.event_survey_access.forEach((row, index) => {
    row.publicReference = publicReference(index);
  });
  fixture.tables.account = fixture.tables.user.map((user) => ({
    id: `account_seed_${String(user.id)}`,
    accountId: String(user.id),
    providerId: "credential",
    userId: String(user.id),
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    password: passwordHash,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));
  fixture.tables.access_grant_code = fixture.tables.access_grant_code.map(
    (row, index) => {
      const grant = fixture.tables.access_grant.find(
        (candidate) => candidate.id === row.accessGrantId,
      );
      assert.ok(grant, `Missing access grant ${String(row.accessGrantId)}`);
      const lookupId = accessCodeLookupId(index);
      const base =
        grant.fulfillmentMode === "shared_code"
          ? String(grant.codePrefix)
          : `${String(grant.codePrefix)}-${String(row.ordinal).padStart(3, "0")}`;
      const issued = issueAccessCode(base, lookupId);
      assert.ok(issued, `Could not issue access code for ${String(row.id)}`);
      return {
        ...row,
        lookupId: issued.lookupId,
        encryptedAccessCode: encryptAccessCode({
          accessCode: issued.accessCode,
          accessGrantId: String(row.accessGrantId),
          lookupId: issued.lookupId,
        }),
      };
    },
  );
  const usedLookupIds = new Set(
    fixture.tables.access_grant_code.map((row) => String(row.lookupId)),
  );
  fixture.tables.enterprise_contract_code =
    fixture.tables.enterprise_contract_code.map((row) => {
      const codePrefix = String(row.codePrefix);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const issued = issueAccessCode(codePrefix);
        if (!issued || usedLookupIds.has(issued.lookupId)) continue;
        usedLookupIds.add(issued.lookupId);
        const storedRow = { ...row };
        delete storedRow.codePrefix;
        return {
          ...storedRow,
          lookupId: issued.lookupId,
          encryptedAccessCode: encryptAccessCode({
            accessCode: issued.accessCode,
            accessGrantId: String(row.enterpriseContractId),
            lookupId: issued.lookupId,
          }),
        };
      }
      throw new Error(
        `Could not issue enterprise contract code for ${String(row.id)}`,
      );
    });
}

const insertionOrder = [
  "coordination_region",
  "organization",
  "user",
  "account",
  "platform_admin",
  "organization_member",
  "event_staff_eligibility",
  "accreditation_logo_asset",
  "offering_image_asset",
  "email_design",
  "email_design_version",
  "learning_activity",
  "learning_activity_version",
  "survey_version",
  "scorm_package_version",
  "onboarding_definition",
  "onboarding_definition_version",
  "onboarding_assignment",
  "onboarding_response",
  "phone_verification_claim",
  "course",
  "course_version",
  "course_version_section",
  "course_version_item",
  "course_version_communication",
  "event_template",
  "event_template_version",
  "event_template_version_region",
  "event_template_version_admin_default",
  "event_template_version_coordinator_default",
  "event_template_session_definition",
  "event_template_version_presenter_default",
  "event_template_version_section",
  "event_template_version_item",
  "event_template_version_communication",
  "event_occurrence",
  "enterprise_contract",
  "enterprise_contract_course_coverage",
  "enterprise_contract_domain",
  "enterprise_contract_event_coverage",
  "enterprise_contract_employee_eligibility",
  "enterprise_contract_owner_assignment",
  "enterprise_contract_code",
  "enterprise_contract_claim",
  "event_occurrence_domain",
  "event_occurrence_region",
  "event_session",
  "event_admin_assignment",
  "event_coordinator_assignment",
  "event_presenter_assignment",
  "event_occurrence_reschedule",
  "event_occurrence_reschedule_region",
  "event_occurrence_reschedule_region_coordinator",
  "event_region_review_round",
  "event_registration",
  "enterprise_contract_event_registration",
  "event_registration_transition",
  "event_registration_region_decision",
  "event_participation",
  "event_attendance",
  "event_section_release",
  "event_survey_access",
  "event_guest_access",
  "event_occurrence_communication_revision",
  "order",
  "order_item",
  "access_grant",
  "access_grant_code",
  "access_grant_domain",
  "access_grant_owner_assignment",
  "bulk_order",
  "order_refund",
  "enrollment",
  "entitlement",
  "learning_item_progress",
] as const;

export async function seedCurrentSnapshot(
  options: Readonly<SeedCurrentSnapshotOptions> = {},
): Promise<void> {
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  if (!configuredDatabaseUrl) throw new Error("DATABASE_URL is required");
  validateExecutionBoundary(configuredDatabaseUrl);
  const provisionExternalAssets = options.provisionExternalAssets ?? true;
  if (!provisionExternalAssets && appEnvironment !== "test")
    throw new Error(
      "External snapshot assets may only be omitted by the test verifier",
    );
  const env = getServerEnv();
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as SnapshotFixture;
  if (fixture.fixtureVersion !== 1)
    throw new Error("Unsupported snapshot fixture version");
  assertCurrentFeatureSamples(fixture);
  verifyExternalAssetMetadata(fixture);
  normalizeSnapshotBaseVersions(fixture);
  overlaySmsTestPhone(fixture);
  const fixtureUserCount = fixture.tables.user.length;

  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    if (await fixtureAlreadyPresent(client, fixture)) {
      console.log(
        JSON.stringify(
          { environment: appEnvironment, status: "already-seeded" },
          null,
          2,
        ),
      );
      return;
    }
    await remapExistingUsers(client, fixture);
    await preserveMigrationSeededEmailDesigns(client, fixture);
    if (provisionExternalAssets) await uploadAssets(fixture);
    prepareRuntimeRows(fixture, await hashPassword(seedPassword));
    const activeEmailVersions = new Map(
      fixture.tables.email_design.map((row) => [
        String(row.id),
        row.activeVersionId,
      ]),
    );
    const coursePublicationDates = new Map(
      (fixture.tables.course_version ?? []).map((row) => [
        String(row.id),
        row.publishedAt,
      ]),
    );
    const eventPublicationDates = new Map(
      (fixture.tables.event_template_version ?? []).map((row) => [
        String(row.id),
        row.publishedAt,
      ]),
    );
    fixture.tables.email_design = fixture.tables.email_design.map((row) => ({
      ...row,
      activeVersionId: null,
    }));
    fixture.tables.course_version = (fixture.tables.course_version ?? []).map(
      (row) => ({ ...row, publishedAt: null }),
    );
    fixture.tables.event_template_version = (
      fixture.tables.event_template_version ?? []
    ).map((row) => ({ ...row, publishedAt: null }));
    await client.query("begin");
    await client.query(
      "select set_config('upskill.enterprise_contract_maintenance', 'on', true)",
    );
    for (const table of insertionOrder)
      await insertRows(client, table, fixture.tables[table] ?? []);
    for (const [id, activeVersionId] of activeEmailVersions)
      if (activeVersionId)
        await client.query(
          `update email_design set "activeVersionId" = $1 where id = $2 and "activeVersionId" is null`,
          [activeEmailVersions.get(id), id],
        );
    for (const [id, publishedAt] of coursePublicationDates)
      if (publishedAt)
        await client.query(
          `update course_version set "publishedAt" = $1 where id = $2`,
          [publishedAt, id],
        );
    for (const [id, publishedAt] of eventPublicationDates)
      if (publishedAt)
        await client.query(
          `update event_template_version set "publishedAt" = $1 where id = $2`,
          [publishedAt, id],
        );
    await client.query("commit");
    const totalRows = insertionOrder.reduce(
      (total, table) => total + (fixture.tables[table]?.length ?? 0),
      0,
    );
    console.log(
      JSON.stringify(
        {
          environment: appEnvironment,
          source: fixture.sourceDescription,
          fixtureRowsConsidered: totalRows,
          usersAdded: fixture.tables.user.length,
          existingUsersReused: fixtureUserCount - fixture.tables.user.length,
          scormPackages: fixture.tables.scorm_package_version.length,
          smsTestOverride: Boolean(smsTestPhone),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href)
  await seedCurrentSnapshot();
