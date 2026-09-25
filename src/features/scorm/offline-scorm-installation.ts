import type { OfflineScormDeviceKeyRecord } from "#/features/scorm/offline-scorm-trusted-runtime";
import { z } from "#/validation/zod";

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );

export const offlineScormInstallationRegistrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  installationId: internalIdSchema,
  publicKeySpki: z
    .string()
    .check(z.minLength(86), z.maxLength(342), z.regex(/^[A-Za-z0-9_-]+$/u)),
});

export type OfflineScormInstallationRegistration = z.infer<
  typeof offlineScormInstallationRegistrationSchema
>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createOfflineScormInstallationRegistration(
  deviceKey: OfflineScormDeviceKeyRecord,
): OfflineScormInstallationRegistration {
  return offlineScormInstallationRegistrationSchema.parse({
    schemaVersion: 1,
    installationId: deviceKey.installationId,
    publicKeySpki: bytesToBase64Url(deviceKey.publicKeySpki),
  });
}
