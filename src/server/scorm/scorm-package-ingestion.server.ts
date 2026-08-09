import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import {
  processScormArchive,
  SCORM_ARCHIVE_LIMITS,
  ScormPackageValidationError,
  type ScormPackageManifest,
} from "#/server/scorm/scorm-package-archive";
import {
  deleteObjectPrefix,
  getObjectBytes,
  putObject,
} from "#/server/storage/object-storage.server";

export interface StageScormPackageInput {
  actorUserId: string;
  archive: Uint8Array;
  packageId?: string;
  title: string;
}

export interface StagedScormPackage {
  packageId: string;
  packageVersionId: string;
  version: number;
  sha256: string;
  quarantineKey: string;
}

export type ScormIngestionOutcome =
  | { status: "ready"; manifest: ScormPackageManifest }
  | { status: "rejected"; code: string }
  | { status: "already-ready" }
  | { status: "already-rejected"; code: string };

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (title.length < 1 || title.length > 200)
    throw new Error("SCORM package title must contain 1 to 200 characters");
  return title;
}

export async function stageScormPackageArchive(
  input: StageScormPackageInput,
): Promise<StagedScormPackage> {
  if (
    input.archive.byteLength === 0 ||
    input.archive.byteLength > SCORM_ARCHIVE_LIMITS.archiveBytes
  )
    throw new ScormPackageValidationError(
      "archive_too_large",
      "SCORM ZIP exceeds the compressed archive limit",
    );
  const title = normalizedTitle(input.title);
  const packageId = input.packageId ?? `scorm_pkg_${randomUUID()}`;
  const packageVersionId = `scorm_pkgv_${randomUUID()}`;
  const sha256 = digest(input.archive);
  const quarantineKey = `scorm/${packageVersionId}/${sha256}.zip`;
  const env = getServerEnv();
  await putObject({
    Bucket: env.S3_QUARANTINE_BUCKET,
    Key: quarantineKey,
    Body: input.archive,
    ContentLength: input.archive.byteLength,
    ContentType: "application/zip",
    Metadata: { "package-version-id": packageVersionId, sha256 },
  });

  const version = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      let nextVersion = 1;
      if (input.packageId) {
        const existingPackage = await transaction
          .selectFrom("scorm_package")
          .select("id")
          .where("id", "=", packageId)
          .forUpdate()
          .executeTakeFirst();
        if (!existingPackage) throw new Error("SCORM package does not exist");
        const latest = await transaction
          .selectFrom("scorm_package_version")
          .select(sql<number>`coalesce(max(version), 0)::integer`.as("version"))
          .where("packageId", "=", packageId)
          .executeTakeFirstOrThrow();
        nextVersion = latest.version + 1;
      } else {
        await transaction
          .insertInto("scorm_package")
          .values({ id: packageId, title })
          .execute();
      }
      const contentPrefix = `scorm/${packageVersionId}/${sha256}`;
      await transaction
        .insertInto("scorm_package_version")
        .values({
          id: packageVersionId,
          packageId,
          version: nextVersion,
          status: "quarantined",
          standard: "scorm-1.2",
          contentPrefix,
          launchPath: "pending.html",
          sha256,
          manifest: {},
          sourceBytes: input.archive.byteLength,
          failureCode: null,
          processedAt: null,
          publishedAt: null,
        })
        .execute();
      await transaction
        .insertInto("audit_event")
        .values({
          id: `audit_${randomUUID()}`,
          actorUserId: input.actorUserId,
          action: "scorm.package_uploaded",
          subjectType: "scorm_package_version",
          subjectId: packageVersionId,
          reason: null,
          metadata: {
            packageId,
            version: nextVersion,
            sourceBytes: input.archive.byteLength,
            sha256,
          },
        })
        .execute();
      await transaction
        .insertInto("outbox_event")
        .values({
          id: `outbox_${randomUUID()}`,
          topic: "scorm.package_ingest_requested",
          aggregateId: packageVersionId,
          payload: { packageVersionId, quarantineKey },
          availableAt: new Date(),
          processedAt: null,
        })
        .execute();
      return nextVersion;
    });
  return {
    packageId,
    packageVersionId,
    version,
    sha256,
    quarantineKey,
  };
}

async function markRejected(
  packageVersionId: string,
  error: ScormPackageValidationError,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const current = await transaction
        .selectFrom("scorm_package_version")
        .select("status")
        .where("id", "=", packageVersionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.status === "ready" || current.status === "rejected") return;
      await transaction
        .updateTable("scorm_package_version")
        .set({
          status: "rejected",
          failureCode: error.code,
          processedAt: new Date(),
          manifest: { failure: { code: error.code, message: error.message } },
        })
        .where("id", "=", packageVersionId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("audit_event")
        .values({
          id: `audit_${randomUUID()}`,
          actorUserId: null,
          action: "scorm.package_rejected",
          subjectType: "scorm_package_version",
          subjectId: packageVersionId,
          reason: error.message,
          metadata: { code: error.code },
        })
        .execute();
    });
}

export async function ingestScormPackageVersion(
  packageVersionId: string,
  quarantineKey: string,
): Promise<ScormIngestionOutcome> {
  const database = getDatabase();
  const version = await database
    .selectFrom("scorm_package_version")
    .select(["id", "status", "sha256", "contentPrefix", "failureCode"])
    .where("id", "=", packageVersionId)
    .executeTakeFirstOrThrow();
  if (version.status === "ready") return { status: "already-ready" };
  if (version.status === "rejected")
    return {
      status: "already-rejected",
      code: version.failureCode ?? "unknown_rejection",
    };
  await database
    .updateTable("scorm_package_version")
    .set({ status: "processing" })
    .where("id", "=", packageVersionId)
    .executeTakeFirstOrThrow();
  const env = getServerEnv();
  try {
    const archive = await getObjectBytes(
      env.S3_QUARANTINE_BUCKET,
      quarantineKey,
      SCORM_ARCHIVE_LIMITS.archiveBytes,
    );
    if (digest(archive) !== version.sha256)
      throw new ScormPackageValidationError(
        "invalid_zip",
        "Quarantined archive digest does not match its registered digest",
      );
    const manifest = await processScormArchive(archive, async (file) => {
      await putObject({
        Bucket: env.S3_LEARNING_CONTENT_BUCKET,
        Key: `${version.contentPrefix}/${file.path}`,
        Body: file.bytes,
        ContentLength: file.bytes.byteLength,
        ContentType: file.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          "package-version-id": packageVersionId,
          "source-sha256": version.sha256,
        },
      });
    });
    await database.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("scorm_package_version")
        .select("status")
        .where("id", "=", packageVersionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.status === "ready" || current.status === "rejected") return;
      await transaction
        .updateTable("scorm_package_version")
        .set({
          status: "ready",
          launchPath: manifest.launchPath,
          manifest,
          failureCode: null,
          processedAt: new Date(),
          publishedAt: new Date(),
        })
        .where("id", "=", packageVersionId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("audit_event")
        .values({
          id: `audit_${randomUUID()}`,
          actorUserId: null,
          action: "scorm.package_ready",
          subjectType: "scorm_package_version",
          subjectId: packageVersionId,
          reason: null,
          metadata: manifest,
        })
        .execute();
    });
    return { status: "ready", manifest };
  } catch (error) {
    if (error instanceof ScormPackageValidationError) {
      await deleteObjectPrefix(
        env.S3_LEARNING_CONTENT_BUCKET,
        `${version.contentPrefix}/`,
      );
      await markRejected(packageVersionId, error);
      return { status: "rejected", code: error.code };
    }
    throw error;
  }
}
