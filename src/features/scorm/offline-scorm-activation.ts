import { offlineScormInstallationRegistrationSchema } from "#/features/scorm/offline-scorm-installation";
import { offlineScormSignedEntitlementEnvelopeSchema } from "#/features/scorm/offline-scorm-entitlement";
import { offlineScormPackageManifestSchema } from "#/features/scorm/offline-scorm-package-prototype";
import { offlineScormReconciliationBatchSchema } from "#/features/scorm/offline-scorm-reconciliation";
import { z } from "#/validation/zod";

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );

export const offlineScormCourseActivationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  registration: offlineScormInstallationRegistrationSchema,
  enrollmentId: internalIdSchema,
  modulePosition: z.number().check(z.int(), z.nonnegative()),
});

export const offlineScormCourseActivationSuccessSchema = z.strictObject({
  status: z.literal("ready-to-download"),
  learner: z.strictObject({
    id: internalIdSchema,
    name: z.string().check(z.minLength(1), z.maxLength(200)),
  }),
  envelope: offlineScormSignedEntitlementEnvelopeSchema,
  trustedSigningKey: z.strictObject({
    algorithm: z.literal("ecdsa-p256-sha256"),
    signingKeyId: z
      .string()
      .check(
        z.minLength(1),
        z.maxLength(100),
        z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
      ),
    publicKeySpki: z
      .string()
      .check(z.minLength(86), z.maxLength(342), z.regex(/^[A-Za-z0-9_-]+$/u)),
  }),
  packageManifest: offlineScormPackageManifestSchema,
});

export const offlineScormSyncRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batch: offlineScormReconciliationBatchSchema,
});

export const offlineScormResolutionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entitlementId: internalIdSchema,
  resolution: z.enum(["reconciled", "discarded"]),
});

export const offlineScormCleanupConfirmationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entitlementId: internalIdSchema,
  cleanupReceiptSha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
});

export const offlineScormResolutionSuccessSchema = z.strictObject({
  status: z.literal("cleanup-required"),
  entitlementId: internalIdSchema,
  packageSiteOrigin: z.url(),
  cleanupCapability: z
    .string()
    .check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/u)),
});

export type OfflineScormCourseActivationSuccess = z.infer<
  typeof offlineScormCourseActivationSuccessSchema
>;
