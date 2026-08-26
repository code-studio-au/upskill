import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminAccountInviteInput,
  AdminAdministratorDirectory,
} from "#/features/admin/admin.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { provisionUser } from "#/server/identity/provisional-user.server";

export async function findAdminAdministrators(
  administrator: AuthenticatedUser,
): Promise<AdminAdministratorDirectory> {
  const database = getDatabase();
  const [active, pending] = await Promise.all([
    database
      .selectFrom("platform_admin as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select([
        "user.id as userId",
        "user.name",
        "user.email",
        "assignment.createdAt as since",
      ])
      .orderBy("user.name")
      .execute(),
    database
      .selectFrom("platform_admin_invitation as invitation")
      .innerJoin("user", "user.id", "invitation.userId")
      .select([
        "user.id as userId",
        "user.name",
        "user.email",
        "invitation.invitedAt as since",
      ])
      .where("invitation.acceptedAt", "is", null)
      .where("invitation.cancelledAt", "is", null)
      .orderBy("user.name")
      .execute(),
  ]);
  return {
    currentUserId: administrator.id,
    administrators: [
      ...active.map((row) => ({
        ...row,
        status: "active" as const,
        since: row.since.toISOString(),
      })),
      ...pending.map((row) => ({
        ...row,
        status: "pending" as const,
        since: row.since.toISOString(),
      })),
    ].toSorted((left, right) => left.name.localeCompare(right.name, "en-AU")),
  };
}

export async function inviteAdminLearner(
  input: AdminAccountInviteInput,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const provisioned = await provisionUser(transaction, {
        ...input,
        source: "administrator",
        actorUserId: administrator.id,
        sourceEventId: `admin-learner:${randomUUID()}`,
        refreshExistingSetup: { reason: "administrator" },
      });
      return {
        outcome: provisioned.created
          ? ("invited" as const)
          : provisioned.notificationId
            ? ("resent" as const)
            : ("existing" as const),
        userId: provisioned.user.id,
      };
    });
}

export async function invitePlatformAdministrator(
  input: AdminAccountInviteInput,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('upskill.platform-admin-management.v1', 0))`.execute(
        transaction,
      );
      const provisioned = await provisionUser(transaction, {
        ...input,
        source: "administrator",
        actorUserId: administrator.id,
        sourceEventId: `platform-admin-invitation:${randomUUID()}`,
        refreshExistingSetup: { reason: "administrator" },
      });
      const existingAdministrator = await transaction
        .selectFrom("platform_admin")
        .select("userId")
        .where("userId", "=", provisioned.user.id)
        .executeTakeFirst();
      if (existingAdministrator)
        return { status: "already-administrator" as const };
      const pending = await transaction
        .selectFrom("platform_admin_invitation")
        .select("id")
        .where("userId", "=", provisioned.user.id)
        .where("acceptedAt", "is", null)
        .where("cancelledAt", "is", null)
        .executeTakeFirst();
      if (pending)
        return {
          status: "pending" as const,
          userId: provisioned.user.id,
        };
      const now = new Date();
      if (
        provisioned.user.accountState === "active" &&
        provisioned.user.emailVerified
      ) {
        await transaction
          .insertInto("platform_admin")
          .values({
            userId: provisioned.user.id,
            grantedByUserId: administrator.id,
            createdAt: now,
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: administrator.id,
          action: "authorization.platform_admin.granted",
          subjectType: "user",
          subjectId: provisioned.user.id,
          aggregateId: provisioned.user.id,
          metadata: { activation: "existing_verified_account" },
          createdAt: now,
        });
        return {
          status: "granted" as const,
          userId: provisioned.user.id,
        };
      }
      const invitationId = `platform_admin_invitation_${randomUUID()}`;
      await transaction
        .insertInto("platform_admin_invitation")
        .values({
          id: invitationId,
          userId: provisioned.user.id,
          invitedByUserId: administrator.id,
          invitedAt: now,
          acceptedAt: null,
          cancelledAt: null,
          cancelledByUserId: null,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "authorization.platform_admin.invited",
        subjectType: "user",
        subjectId: provisioned.user.id,
        aggregateId: provisioned.user.id,
        metadata: { invitationId },
        createdAt: now,
      });
      return { status: "invited" as const, userId: provisioned.user.id };
    });
}

export async function removePlatformAdministrator(
  userId: string,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('upskill.platform-admin-management.v1', 0))`.execute(
        transaction,
      );
      const pending = await transaction
        .selectFrom("platform_admin_invitation")
        .select("id")
        .where("userId", "=", userId)
        .where("acceptedAt", "is", null)
        .where("cancelledAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (pending) {
        const now = new Date();
        await transaction
          .updateTable("platform_admin_invitation")
          .set({ cancelledAt: now, cancelledByUserId: administrator.id })
          .where("id", "=", pending.id)
          .executeTakeFirstOrThrow();
        await recordDurableAuditEvent(transaction, {
          actorUserId: administrator.id,
          action: "authorization.platform_admin.invitation_cancelled",
          subjectType: "user",
          subjectId: userId,
          aggregateId: userId,
          metadata: { invitationId: pending.id },
          createdAt: now,
        });
        return { status: "invitation-cancelled" as const };
      }
      const assignment = await transaction
        .selectFrom("platform_admin")
        .select("userId")
        .where("userId", "=", userId)
        .forUpdate()
        .executeTakeFirst();
      if (!assignment) return { status: "not-found" as const };
      if (userId === administrator.id) return { status: "self" as const };
      const count = await transaction
        .selectFrom("platform_admin")
        .select(sql<number>`count(*)::integer`.as("count"))
        .executeTakeFirstOrThrow();
      if (count.count <= 1) return { status: "last-administrator" as const };
      const [eventAssignments, templateDefaults] = await Promise.all([
        transaction
          .selectFrom("event_admin_assignment")
          .select(sql<number>`count(*)::integer`.as("count"))
          .where("userId", "=", userId)
          .where("endedAt", "is", null)
          .executeTakeFirstOrThrow(),
        transaction
          .selectFrom("event_template_version_admin_default as defaults")
          .innerJoin(
            "event_template_version as version",
            "version.id",
            "defaults.eventTemplateVersionId",
          )
          .innerJoin(
            "event_template as template",
            "template.id",
            "version.eventTemplateId",
          )
          .select(sql<number>`count(distinct template.id)::integer`.as("count"))
          .where("defaults.userId", "=", userId)
          .where("template.status", "!=", "archived")
          .where(
            sql<boolean>`(
            version.version = (
              select max(current_version.version)
              from event_template_version current_version
              where current_version."eventTemplateId" = version."eventTemplateId"
            )
            or version.version = (
              select max(published_version.version)
              from event_template_version published_version
              where published_version."eventTemplateId" = version."eventTemplateId"
                and published_version."publishedAt" is not null
            )
          )`,
          )
          .executeTakeFirstOrThrow(),
      ]);
      if (eventAssignments.count > 0 || templateDefaults.count > 0)
        return {
          status: "event-responsibility" as const,
          eventAssignmentCount: eventAssignments.count,
          templateDefaultCount: templateDefaults.count,
        };
      const now = new Date();
      await transaction
        .deleteFrom("platform_admin")
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "authorization.platform_admin.revoked",
        subjectType: "user",
        subjectId: userId,
        aggregateId: userId,
        createdAt: now,
      });
      return { status: "revoked" as const };
    });
}
