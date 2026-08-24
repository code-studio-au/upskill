import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import type {
  LearnerProfile,
  LearnerProfileUpdateResult,
} from "#/features/profile/learner-profile.schema";
import { logServerEvent } from "#/server/logging/server-logger";
import { invalidateVerifiedPhone } from "./contact-verification-core.server";

export async function findLearnerProfile(
  user: AuthenticatedUser,
): Promise<LearnerProfile> {
  const database = getDatabase();
  const profile = await database
    .selectFrom("user")
    .select([
      "name",
      "email",
      "emailEnabled",
      "emailVerified",
      "emailVerifiedAt",
      "phone",
      "smsEnabled",
      "smsVerifiedAt",
      "currentRegionId",
    ])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  const regions = await database
    .selectFrom("coordination_region as region")
    .innerJoin("coordination_region as parent", "parent.id", "region.parentId")
    .select([
      "region.id",
      "region.name",
      "region.status",
      "parent.name as groupName",
      "parent.status as groupStatus",
    ])
    .where("region.kind", "=", "operational")
    .where("parent.kind", "=", "group")
    .where((expression) =>
      expression.or([
        expression.and([
          expression("region.status", "=", "active"),
          expression("parent.status", "=", "active"),
        ]),
        expression("region.id", "=", profile.currentRegionId ?? ""),
      ]),
    )
    .orderBy("parent.name")
    .orderBy("region.name")
    .execute();
  return {
    name: profile.name,
    email: profile.email,
    emailEnabled: profile.emailEnabled,
    emailVerified: profile.emailVerified,
    emailVerifiedAt: profile.emailVerifiedAt?.toISOString() ?? null,
    phone: profile.phone,
    smsEnabled: profile.smsEnabled,
    smsVerifiedAt: profile.smsVerifiedAt?.toISOString() ?? null,
    currentRegionId: profile.currentRegionId,
    regions: regions.map((region) => ({
      id: region.id,
      name: region.name,
      groupName: region.groupName,
      active: region.status === "active" && region.groupStatus === "active",
    })),
  };
}

export async function updateLearnerProfile(
  input: {
    name: string;
    phone: string;
    currentRegionId: string;
    emailEnabled: boolean;
    smsEnabled: boolean;
  },
  user: AuthenticatedUser,
): Promise<LearnerProfileUpdateResult> {
  const name = input.name.trim();
  const phone = input.phone ? normalizeInternationalPhone(input.phone) : null;
  const currentRegionId = input.currentRegionId || null;
  if (!name || (input.phone && !phone) || (input.smsEnabled && !phone))
    return { status: "invalid" };
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const existing = await transaction
      .selectFrom("user")
      .select([
        "name",
        "phone",
        "emailEnabled",
        "smsEnabled",
        "currentRegionId",
      ])
      .where("id", "=", user.id)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) return { status: "unavailable" };
    if (currentRegionId) {
      const region = await transaction
        .selectFrom("coordination_region as region")
        .innerJoin(
          "coordination_region as parent",
          "parent.id",
          "region.parentId",
        )
        .select("region.id")
        .where("region.id", "=", currentRegionId)
        .where("region.kind", "=", "operational")
        .where("region.status", "=", "active")
        .where("parent.kind", "=", "group")
        .where("parent.status", "=", "active")
        .executeTakeFirst();
      if (!region) return { status: "invalid" };
    }
    const existingPhone = normalizeInternationalPhone(existing.phone ?? "");
    const phoneChanged = existingPhone !== phone;
    const changedFields = [
      ...(existing.name !== name ? ["name"] : []),
      ...(phoneChanged ? ["phone"] : []),
      ...(existing.emailEnabled !== input.emailEnabled ? ["emailEnabled"] : []),
      ...(existing.smsEnabled !== input.smsEnabled ? ["smsEnabled"] : []),
      ...(existing.currentRegionId !== currentRegionId
        ? ["currentRegionId"]
        : []),
    ];
    const now = new Date();
    if (phoneChanged) await invalidateVerifiedPhone(transaction, user.id, now);
    await transaction
      .updateTable("user")
      .set({
        name,
        phone,
        emailEnabled: input.emailEnabled,
        smsEnabled: input.smsEnabled,
        currentRegionId,
        updatedAt: now,
      })
      .where("id", "=", user.id)
      .execute();
    if (changedFields.length > 0)
      logServerEvent({
        level: "info",
        event: "profile.updated",
        fields: {
          entityType: "user",
          entityId: user.id,
          actorUserId: user.id,
          changedFields: changedFields.join(","),
        },
      });
    return { status: "updated" };
  });
}
