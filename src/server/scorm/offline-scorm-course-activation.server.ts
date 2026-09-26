import "@tanstack/react-start/server-only";

import {
  offlineScormCourseActivationSchema,
  offlineScormCourseActivationSuccessSchema,
  type OfflineScormCourseActivationSuccess,
} from "#/features/scorm/offline-scorm-activation";
import { offlineScormPackageManifestSchema } from "#/features/scorm/offline-scorm-package-prototype";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { createOfflineScormEntitlementSigningRuntime } from "#/server/scorm/offline-scorm-entitlement-signing-runtime.server";
import { issueOfflineScormEntitlement } from "#/server/scorm/offline-scorm-entitlement.server";
import { registerOfflineScormInstallation } from "#/server/scorm/offline-scorm-installation.server";
import { createOfflineScormPackageSiteProvisioner } from "#/server/scorm/offline-scorm-package-site.server";
import { z } from "#/validation/zod.server";

const storedPackageManifestSchema = z.object({
  launchPath: z.string().min(1).max(2_047),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(2_047),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        sizeBytes: z
          .number()
          .int()
          .nonnegative()
          .max(64 * 1024 * 1024),
        contentType: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(5_000),
});

export type OfflineScormCourseActivationResult =
  | OfflineScormCourseActivationSuccess
  | {
      status: "denied";
      reason:
        | "activation-disabled"
        | "package-inventory-unavailable"
        | "active-installation-exists"
        | "installation-unavailable"
        | "public-key-invalid"
        | "not-found"
        | "access-unavailable"
        | "questionnaire-incomplete"
        | "item-unavailable"
        | "section-unreleased"
        | "unavailable"
        | "offline-writer-active"
        | "finite-access-expiry-required";
    };

async function resolveCoursePackageInventory(input: {
  enrollmentId: string;
  modulePosition: number;
  userId: string;
}) {
  const candidate = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin("course_version_item as item", (join) =>
      join
        .onRef("item.courseVersionId", "=", "enrollment.courseVersionId")
        .on("item.kind", "=", "scorm")
        .on("item.modulePosition", "=", input.modulePosition),
    )
    .innerJoin(
      "scorm_package_version as package",
      "package.id",
      "item.learningActivityVersionId",
    )
    .select([
      "package.id as packageVersionId",
      "package.sha256 as packageSha256",
      "package.manifest as manifest",
      "package.status as packageStatus",
    ])
    .where("enrollment.id", "=", input.enrollmentId)
    .where("enrollment.userId", "=", input.userId)
    .executeTakeFirst();
  if (!candidate || candidate.packageStatus !== "ready") return undefined;
  const manifest = storedPackageManifestSchema.safeParse(candidate.manifest);
  if (!manifest.success) return undefined;
  return { ...candidate, manifest: manifest.data };
}

/**
 * Activates only the initial self-paced Course path. Package inventory is
 * preflighted before writer ownership changes so an older package without the
 * immutable file inventory cannot strand an attempt in offline mode.
 */
export async function activateOfflineScormCourse(
  input: unknown,
  user: AuthenticatedUser,
): Promise<OfflineScormCourseActivationResult> {
  const environment = getServerEnv();
  if (!environment.OFFLINE_SCORM_ENABLED)
    return { status: "denied", reason: "activation-disabled" };
  const activation = offlineScormCourseActivationSchema.parse(input);
  const packageInventory = await resolveCoursePackageInventory({
    enrollmentId: activation.enrollmentId,
    modulePosition: activation.modulePosition,
    userId: user.id,
  });
  if (!packageInventory)
    return { status: "denied", reason: "package-inventory-unavailable" };
  const preflightManifest = offlineScormPackageManifestSchema.safeParse({
    schemaVersion: 1,
    packageVersionId: packageInventory.packageVersionId,
    packageSha256: packageInventory.packageSha256,
    runtimeVersion: "offline-scorm-1",
    packageOrigin: `https://p-${"0".repeat(56)}.offline.invalid`,
    entrypointPath: `/${packageInventory.manifest.launchPath}`,
    files: packageInventory.manifest.files.map((file) => ({
      pathname: `/${file.path}`,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
    })),
  });
  if (!preflightManifest.success)
    return { status: "denied", reason: "package-inventory-unavailable" };

  const registration = await registerOfflineScormInstallation(
    activation.registration,
    user,
  );
  if (registration.status === "denied") return registration;

  const signingRuntime =
    createOfflineScormEntitlementSigningRuntime(environment);
  const issuance = await issueOfflineScormEntitlement(
    {
      target: {
        kind: "course",
        enrollmentId: activation.enrollmentId,
        modulePosition: activation.modulePosition,
      },
      installationId: registration.installationId,
    },
    user,
    signingRuntime.signer,
    createOfflineScormPackageSiteProvisioner(environment),
    {
      packageVersionId: packageInventory.packageVersionId,
      packageSha256: packageInventory.packageSha256,
    },
  );
  if (issuance.status === "denied") return issuance;

  const packageManifest = offlineScormPackageManifestSchema.parse({
    ...preflightManifest.data,
    packageOrigin: issuance.packageSiteOrigin,
  });

  return offlineScormCourseActivationSuccessSchema.parse({
    status: "ready-to-download",
    learner: { id: user.id, name: user.name },
    envelope: issuance.envelope,
    trustedSigningKey: signingRuntime.trustedPublicKey,
    packageManifest,
  });
}
