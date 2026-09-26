import "@tanstack/react-start/server-only";

import { offlineScormInstallationRegistrationSchema } from "#/features/scorm/offline-scorm-installation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  offlineScormPublicKeySha256,
  parseOfflineScormP256PublicKey,
} from "#/server/scorm/offline-scorm-crypto.server";

export type OfflineScormInstallationRegistrationResult =
  | {
      status: "registered";
      installationId: string;
      publicKeySha256: string;
      registeredAt: Date;
      recovered: boolean;
    }
  | {
      status: "denied";
      reason:
        | "active-installation-exists"
        | "installation-unavailable"
        | "public-key-invalid";
    };

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

/**
 * Registers the device-held signing key behind the existing one-active-device
 * invariant. This command remains unreachable from HTTP until activation can
 * return a signed entitlement and complete package download contract.
 */
export async function registerOfflineScormInstallation(
  input: unknown,
  user: AuthenticatedUser,
): Promise<OfflineScormInstallationRegistrationResult> {
  const registration = offlineScormInstallationRegistrationSchema.parse(input);
  const publicKeySpki = decodeCanonicalBase64Url(registration.publicKeySpki);
  if (!publicKeySpki || !parseOfflineScormP256PublicKey({ publicKeySpki }))
    return { status: "denied", reason: "public-key-invalid" };
  const publicKeySha256 = offlineScormPublicKeySha256(publicKeySpki);
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const owner = await transaction
        .selectFrom("user")
        .select("id")
        .where("id", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!owner)
        return {
          status: "denied",
          reason: "installation-unavailable",
        } as const;

      const existing = await transaction
        .selectFrom("offline_learning_installation")
        .select([
          "id",
          "userId",
          "publicKeySpki",
          "publicKeySha256",
          "status",
          "registeredAt",
        ])
        .where("id", "=", registration.installationId)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.userId === user.id &&
          existing.status === "active" &&
          existing.publicKeySha256 === publicKeySha256 &&
          Buffer.from(existing.publicKeySpki).equals(publicKeySpki)
        )
          return {
            status: "registered",
            installationId: existing.id,
            publicKeySha256: existing.publicKeySha256,
            registeredAt: existing.registeredAt,
            recovered: true,
          } as const;
        return {
          status: "denied",
          reason: "installation-unavailable",
        } as const;
      }

      const active = await transaction
        .selectFrom("offline_learning_installation")
        .select("id")
        .where("userId", "=", user.id)
        .where("status", "=", "active")
        .executeTakeFirst();
      if (active)
        return {
          status: "denied",
          reason: "active-installation-exists",
        } as const;

      const historicalKey = await transaction
        .selectFrom("offline_learning_installation")
        .select("id")
        .where("userId", "=", user.id)
        .where("publicKeySha256", "=", publicKeySha256)
        .executeTakeFirst();
      if (historicalKey)
        return {
          status: "denied",
          reason: "installation-unavailable",
        } as const;

      const registeredAt = new Date();
      await transaction
        .insertInto("offline_learning_installation")
        .values({
          id: registration.installationId,
          userId: user.id,
          publicKeySpki,
          publicKeySha256,
          replacementInstallationId: null,
          registeredAt,
          endedAt: null,
          updatedAt: registeredAt,
        })
        .executeTakeFirstOrThrow();
      return {
        status: "registered",
        installationId: registration.installationId,
        publicKeySha256,
        registeredAt,
        recovered: false,
      } as const;
    });

  if (result.status === "registered" && !result.recovered)
    logServerEvent({
      level: "info",
      event: "scorm.offline_installation_registered",
      fields: {
        actorUserId: user.id,
        entityType: "offline_learning_installation",
        entityId: result.installationId,
      },
    });
  return result;
}

/**
 * Revokes a server installation only when no entitlement has ever used it.
 * The return value authorizes the trusted client to discard the matching key.
 */
export async function retireUnusedOfflineScormInstallation(input: {
  installationId: string;
  userId: string;
}): Promise<boolean> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const installation = await transaction
        .selectFrom("offline_learning_installation")
        .select(["id", "status"])
        .where("id", "=", input.installationId)
        .where("userId", "=", input.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!installation) return { discard: true, revoked: false };
      const entitlement = await transaction
        .selectFrom("offline_learning_entitlement")
        .select("id")
        .where("installationId", "=", installation.id)
        .executeTakeFirst();
      if (entitlement) return { discard: false, revoked: false };
      if (installation.status !== "active")
        return { discard: true, revoked: false };
      const endedAt = new Date();
      await transaction
        .updateTable("offline_learning_installation")
        .set({ status: "revoked", endedAt, updatedAt: endedAt })
        .where("id", "=", installation.id)
        .where("userId", "=", input.userId)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      return { discard: true, revoked: true };
    });
  if (result.revoked)
    logServerEvent({
      level: "info",
      event: "scorm.offline_unused_installation_revoked",
      fields: {
        actorUserId: input.userId,
        entityType: "offline_learning_installation",
        entityId: input.installationId,
      },
    });
  return result.discard;
}
