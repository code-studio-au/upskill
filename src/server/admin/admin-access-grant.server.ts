import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminAccessGrantCapacityInput,
  AdminAccessGrantCreateInput,
  AdminAccessGrantDirectory,
  AdminAccessGrantRedemptionPage,
  AdminAccessGrantRedemptionsInput,
  AdminAccessGrantRevealInput,
  AdminAccessGrantRevokeInput,
} from "#/features/admin-access/admin-access.schema";
import {
  normalizeAccessOwnerEmails,
  normalizeAdminAccessDomains,
} from "#/features/admin-access/admin-access.schema";
import { formatAccessCode } from "#/server/access/access-code.server";
import { decryptAccessCode } from "#/server/access/access-code-encryption.server";
import { issueGrantCodes } from "#/server/access/access-grant-code-issuance.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { localDateIsoSchema } from "#/features/shared/time.schema";
import { getDatabase } from "#/server/db/database.server";
import { instantToDate, utcEndOfDate } from "#/server/time/time.server";
import { provisionUser } from "#/server/identity/provisional-user.server";
import { findReservedEventPlaces } from "#/server/checkout/event-commerce-capacity.server";

const DIRECTORY_LIMIT = 100;
const REDEMPTION_PAGE_SIZE = 100;
function organizationSlug(name: string, id: string): string {
  const base = name
    .toLocaleLowerCase("en-AU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 70);
  return `${base || "organisation"}-${id.slice(-8)}`;
}

function accessState(row: {
  completedAt: Date | null;
  expiresAt: Date | null;
  removedAt: Date | null;
  status: "active" | "completed" | "expired" | "cancelled";
}): "active" | "completed" | "expired" | "removed" {
  if (row.removedAt || row.status === "cancelled") return "removed";
  if (row.expiresAt && row.expiresAt <= new Date()) return "expired";
  return row.completedAt || row.status === "completed" ? "completed" : "active";
}

export async function findAdminAccessGrants(): Promise<AdminAccessGrantDirectory> {
  const database = getDatabase();
  const [courseTargets, eventTargets, grants] = await Promise.all([
    database
      .selectFrom("course_version")
      .innerJoin("course", "course.id", "course_version.courseId")
      .select([
        "course_version.id as courseVersionId",
        "course_version.version",
        "course.title as courseTitle",
      ])
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .orderBy("course.title")
      .orderBy("course_version.version", "desc")
      .execute(),
    database
      .selectFrom("event_occurrence")
      .select(["id", "title", "startsAt"])
      .where("status", "=", "published")
      .where("startsAt", ">", new Date())
      .orderBy("startsAt")
      .execute(),
    database
      .selectFrom("access_grant")
      .leftJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .leftJoin("course", "course.id", "course_version.courseId")
      .leftJoin(
        "event_occurrence",
        "event_occurrence.id",
        "access_grant.eventOccurrenceId",
      )
      .leftJoin(
        "organization",
        "organization.id",
        "access_grant.organizationId",
      )
      .select([
        "access_grant.id",
        "access_grant.label",
        "access_grant.quantity",
        "access_grant.redeemed",
        "access_grant.enrollmentDurationDays",
        "access_grant.expiresAt",
        "access_grant.revokedAt",
        "access_grant.createdAt",
        "access_grant.kind",
        "access_grant.customerExtendable",
        "access_grant.fulfillmentMode",
        "organization.name as organizationName",
        "course.title as courseTitle",
        "course_version.version as courseVersion",
        "event_occurrence.title as eventTitle",
        "event_occurrence.startsAt as eventStartsAt",
      ])
      .where("access_grant.kind", "in", [
        "bulk_purchase",
        "enterprise_contract",
      ])
      .orderBy("access_grant.createdAt", "desc")
      .limit(DIRECTORY_LIMIT)
      .execute(),
  ]);

  const targets: AdminAccessGrantDirectory["targets"] = [
    ...courseTargets.map((target) => ({
      type: "course" as const,
      id: target.courseVersionId,
      title: target.courseTitle,
      detail: `Version ${String(target.version)}`,
    })),
    ...eventTargets.map((target) => ({
      type: "event" as const,
      id: target.id,
      title: target.title,
      detail: target.startsAt.toISOString(),
    })),
  ];

  const grantIds = grants.map((grant) => grant.id);
  if (grantIds.length === 0) return { targets, grants: [] };
  const [domainRows, ownerRows] = await Promise.all([
    database
      .selectFrom("access_grant_domain")
      .select(["accessGrantId", "domain"])
      .where("accessGrantId", "in", grantIds)
      .orderBy("domain")
      .execute(),
    database
      .selectFrom("access_grant_owner_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select([
        "assignment.id",
        "assignment.accessGrantId",
        "assignment.activatedAt",
        "user.name",
        "assignment.invitedEmail as email",
      ])
      .where("assignment.accessGrantId", "in", grantIds)
      .where("assignment.revokedAt", "is", null)
      .orderBy("assignment.invitedAt")
      .execute(),
  ]);
  const domains = new Map<string, Array<string>>();
  for (const row of domainRows)
    domains.set(row.accessGrantId, [
      ...(domains.get(row.accessGrantId) ?? []),
      row.domain,
    ]);
  const owners = new Map<
    string,
    AdminAccessGrantDirectory["grants"][number]["owners"]
  >();
  for (const owner of ownerRows)
    owners.set(owner.accessGrantId, [
      ...(owners.get(owner.accessGrantId) ?? []),
      {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        status: owner.activatedAt ? "active" : "pending",
      },
    ]);
  return {
    targets,
    grants: grants.map((grant) => ({
      id: grant.id,
      label: grant.label ?? "Purchased access",
      organizationName: grant.organizationName,
      offeringType: grant.eventTitle ? "event" : "course",
      offeringTitle:
        grant.eventTitle ?? grant.courseTitle ?? "Unavailable offering",
      offeringDetail: grant.eventStartsAt
        ? grant.eventStartsAt.toISOString()
        : `Version ${String(grant.courseVersion ?? "unknown")}`,
      quantity: grant.quantity,
      redeemed: grant.redeemed,
      enrollmentDurationDays: grant.enrollmentDurationDays,
      domains: domains.get(grant.id) ?? [],
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      createdAt: grant.createdAt.toISOString(),
      kind: grant.kind === "individual_purchase" ? "bulk_purchase" : grant.kind,
      customerExtendable: grant.customerExtendable,
      fulfillmentMode: grant.fulfillmentMode ?? "shared_code",
      owners: owners.get(grant.id) ?? [],
    })),
  };
}

export async function findAdminAccessGrantRedemptions(
  input: AdminAccessGrantRedemptionsInput,
): Promise<AdminAccessGrantRedemptionPage | null> {
  const database = getDatabase();
  const grant = await database
    .selectFrom("access_grant")
    .select(["id", "eventOccurrenceId"])
    .where("id", "=", input.accessGrantId)
    .executeTakeFirst();
  if (!grant) return null;
  const offset = (input.page - 1) * REDEMPTION_PAGE_SIZE;
  if (grant.eventOccurrenceId) {
    const [count, rows] = await Promise.all([
      database
        .selectFrom("event_access_redemption")
        .select(sql<number>`count(*)::integer`.as("total"))
        .where("accessGrantId", "=", input.accessGrantId)
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("event_access_redemption as redemption")
        .innerJoin("user", "user.id", "redemption.userId")
        .innerJoin(
          "event_participation as participation",
          "participation.id",
          "redemption.eventParticipationId",
        )
        .select([
          "redemption.eventRegistrationId",
          "redemption.redeemedAt",
          "participation.completedAt",
          "user.id as learnerId",
          "user.name as learnerName",
          "user.email as learnerEmail",
        ])
        .where("redemption.accessGrantId", "=", input.accessGrantId)
        .orderBy("redemption.redeemedAt", "desc")
        .limit(REDEMPTION_PAGE_SIZE)
        .offset(offset)
        .execute(),
    ]);
    return {
      rows: rows.map((row) => ({
        enrollmentId: row.eventRegistrationId,
        learnerId: row.learnerId,
        learnerName: row.learnerName,
        learnerEmail: row.learnerEmail,
        enrolledAt: row.redeemedAt.toISOString(),
        state: row.completedAt ? "completed" : "active",
      })),
      page: input.page,
      pageSize: REDEMPTION_PAGE_SIZE,
      total: count.total,
    };
  }
  const [count, rows] = await Promise.all([
    database
      .selectFrom("enrollment")
      .select(sql<number>`count(*)::integer`.as("total"))
      .where("accessGrantId", "=", input.accessGrantId)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("enrollment")
      .innerJoin("user", "user.id", "enrollment.userId")
      .select([
        "enrollment.id as enrollmentId",
        "enrollment.status",
        "enrollment.enrolledAt",
        "enrollment.completedAt",
        "enrollment.expiresAt",
        "enrollment.removedAt",
        "user.id as learnerId",
        "user.name as learnerName",
        "user.email as learnerEmail",
      ])
      .where("enrollment.accessGrantId", "=", input.accessGrantId)
      .orderBy("enrollment.enrolledAt", "desc")
      .orderBy("enrollment.id")
      .limit(REDEMPTION_PAGE_SIZE)
      .offset(offset)
      .execute(),
  ]);
  return {
    rows: rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      learnerEmail: row.learnerEmail,
      enrolledAt: row.enrolledAt.toISOString(),
      state: accessState(row),
    })),
    page: input.page,
    pageSize: REDEMPTION_PAGE_SIZE,
    total: count.total,
  };
}

type CreateOutcome =
  | {
      status: "created";
      accessGrantId: string;
      accessCode: string | null;
      generatedCodeCount: number;
    }
  | { status: "not-found"; entity: "offering" }
  | {
      status: "conflict";
      reason: "event_capacity_unavailable" | "expiry_not_future";
    };

export async function createAdminAccessGrant(
  input: AdminAccessGrantCreateInput,
  administrator: AuthenticatedUser,
): Promise<CreateOutcome> {
  const expiresAt = input.expiresOn
    ? instantToDate(utcEndOfDate(localDateIsoSchema.parse(input.expiresOn)))
    : null;
  const now = new Date();
  if (expiresAt && expiresAt <= now)
    return { status: "conflict", reason: "expiry_not_future" };
  const domainRestrictions = normalizeAdminAccessDomains(input.domains);
  if (!domainRestrictions)
    throw new Error("Validated access-grant domains became invalid");
  const ownerEmails = normalizeAccessOwnerEmails(input.ownerEmails);
  if (!ownerEmails)
    throw new Error("Validated Access Owner emails became invalid");
  const accessCode = formatAccessCode(input.accessCode);
  if (!accessCode)
    throw new Error("Validated administrator access code became invalid");

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const courseTarget =
        input.targetType === "course"
          ? await transaction
              .selectFrom("course_version")
              .innerJoin("course", "course.id", "course_version.courseId")
              .select([
                "course_version.id",
                "course_version.version",
                "course.id as courseId",
              ])
              .where("course_version.id", "=", input.targetId)
              .where("course_version.publishedAt", "is not", null)
              .where("course.status", "=", "published")
              .executeTakeFirst()
          : null;
      const eventTarget =
        input.targetType === "event"
          ? await transaction
              .selectFrom("event_occurrence")
              .select(["id", "title", "startsAt", "capacity", "confirmedCount"])
              .where("id", "=", input.targetId)
              .where("status", "=", "published")
              .where("startsAt", ">", now)
              .forUpdate()
              .executeTakeFirst()
          : null;
      if (!courseTarget && !eventTarget)
        return { status: "not-found", entity: "offering" };
      if (eventTarget) {
        const reservedPlaces = await findReservedEventPlaces(
          transaction,
          eventTarget.id,
          now,
        );
        if (
          eventTarget.confirmedCount + reservedPlaces + input.quantity >
          eventTarget.capacity
        )
          return { status: "conflict", reason: "event_capacity_unavailable" };
      }

      const organizationName = input.organizationName.trim();
      const organizationLock = organizationName.toLocaleLowerCase("en-AU");
      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`access-organisation:${organizationLock}`}, 0)
      )`.execute(transaction);
      let organization = await transaction
        .selectFrom("organization")
        .select("id")
        .where(sql<boolean>`lower(name) = ${organizationLock}`)
        .orderBy("createdAt")
        .executeTakeFirst();
      if (!organization) {
        const organizationId = `organization_${randomUUID()}`;
        organization = await transaction
          .insertInto("organization")
          .values({
            id: organizationId,
            name: organizationName,
            slug: organizationSlug(organizationName, organizationId),
            createdAt: now,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      }

      const accessGrantId = `access_grant_${randomUUID()}`;
      await transaction
        .insertInto("access_grant")
        .values({
          id: accessGrantId,
          organizationId: organization.id,
          orderId: null,
          courseVersionId: courseTarget?.id ?? null,
          eventOccurrenceId: eventTarget?.id ?? null,
          label: input.label.trim(),
          createdByUserId: administrator.id,
          enrollmentDurationDays: courseTarget
            ? input.enrollmentDurationDays
            : null,
          quantity: input.quantity,
          redeemed: 0,
          expiresAt,
          revokedAt: null,
          revokedByUserId: null,
          createdAt: now,
          kind: input.kind,
          customerExtendable: input.customerExtendable,
          fulfillmentMode: input.fulfillmentMode,
          codePrefix: accessCode,
        })
        .execute();
      const issuedCodes = await issueGrantCodes(transaction, {
        accessGrantId,
        prefix: accessCode,
        count: input.fulfillmentMode === "shared_code" ? 1 : input.quantity,
        firstOrdinal: input.fulfillmentMode === "shared_code" ? null : 1,
        createdAt: now,
      });
      if (domainRestrictions.length > 0)
        await transaction
          .insertInto("access_grant_domain")
          .values(
            domainRestrictions.map((domain) => ({
              accessGrantId,
              domain,
              createdAt: now,
            })),
          )
          .execute();
      for (const ownerEmail of ownerEmails) {
        const assignmentId = `access_owner_${randomUUID()}`;
        const provisioned = await provisionUser(transaction, {
          name:
            ownerEmail.split("@")[0]?.replaceAll(/[._-]+/gu, " ") ??
            "Access Owner",
          email: ownerEmail,
          source: "access_owner",
          actorUserId: administrator.id,
          sourceEventId: assignmentId,
          createdAt: now,
        });
        const ownerUserId = provisioned.user.id;
        const account = await transaction
          .selectFrom("user")
          .select(["accountState", "emailVerified"])
          .where("id", "=", ownerUserId)
          .executeTakeFirstOrThrow();
        const activatedAt =
          account.accountState === "active" && account.emailVerified
            ? now
            : null;
        await transaction
          .insertInto("access_grant_owner_assignment")
          .values({
            id: assignmentId,
            accessGrantId,
            userId: ownerUserId,
            invitedEmail: ownerEmail,
            invitedByUserId: administrator.id,
            invitedAt: now,
            activatedAt,
            revokedAt: null,
            revokedByUserId: null,
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: administrator.id,
          action: "access_grant.owner_assigned",
          subjectType: "access_grant_owner_assignment",
          subjectId: assignmentId,
          aggregateId: accessGrantId,
          metadata: { accessGrantId, ownerUserId },
          createdAt: now,
        });
      }
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "access_grant.administrator_created",
        subjectType: "access_grant",
        subjectId: accessGrantId,
        metadata: {
          targetType: input.targetType,
          courseId: courseTarget?.courseId ?? null,
          courseVersionId: courseTarget?.id ?? null,
          courseVersion: courseTarget?.version ?? null,
          eventOccurrenceId: eventTarget?.id ?? null,
          organizationId: organization.id,
          quantity: input.quantity,
          domainRestrictionCount: domainRestrictions.length,
          ownerCount: ownerEmails.length,
          kind: input.kind,
          customerExtendable: input.customerExtendable,
          fulfillmentMode: input.fulfillmentMode,
        },
        createdAt: now,
      });
      return {
        status: "created",
        accessGrantId,
        accessCode:
          input.fulfillmentMode === "shared_code"
            ? (issuedCodes[0] ?? null)
            : null,
        generatedCodeCount: issuedCodes.length,
      };
    });
}

type RevealOutcome =
  | { status: "ready"; accessGrantId: string; accessCode: string }
  | { status: "not-found"; entity: "access-grant" };

export async function revealAdminAccessGrantCode(
  input: AdminAccessGrantRevealInput,
  administrator: AuthenticatedUser,
): Promise<RevealOutcome> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const grant = await transaction
        .selectFrom("access_grant")
        .innerJoin(
          "access_grant_code",
          "access_grant_code.accessGrantId",
          "access_grant.id",
        )
        .select([
          "access_grant.id",
          "access_grant.courseVersionId",
          "access_grant.organizationId",
          "access_grant_code.lookupId",
          "access_grant_code.encryptedAccessCode",
        ])
        .where("access_grant.id", "=", input.accessGrantId)
        .where("access_grant_code.ordinal", "is", null)
        .executeTakeFirst();
      if (!grant) return { status: "not-found", entity: "access-grant" };
      const accessCode = decryptAccessCode({
        accessGrantId: grant.id,
        lookupId: grant.lookupId,
        encryptedAccessCode: grant.encryptedAccessCode,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "access_grant.administrator_code_revealed",
        subjectType: "access_grant",
        subjectId: grant.id,
        metadata: {
          courseVersionId: grant.courseVersionId,
          organizationId: grant.organizationId,
        },
      });
      return {
        status: "ready",
        accessGrantId: grant.id,
        accessCode,
      };
    });
}

type CapacityOutcome =
  | { status: "capacity-updated" | "unchanged"; accessGrantId: string }
  | { status: "not-found"; entity: "access-grant" }
  | {
      status: "conflict";
      reason: "capacity_below_redeemed" | "batch_capacity_reduction";
    };

export async function updateAdminAccessGrantCapacity(
  input: AdminAccessGrantCapacityInput,
  administrator: AuthenticatedUser,
): Promise<CapacityOutcome> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const grant = await transaction
        .selectFrom("access_grant")
        .select([
          "id",
          "courseVersionId",
          "organizationId",
          "quantity",
          "redeemed",
          "fulfillmentMode",
          "codePrefix",
        ])
        .where("id", "=", input.accessGrantId)
        .where("kind", "in", ["bulk_purchase", "enterprise_contract"])
        .forUpdate()
        .executeTakeFirst();
      if (!grant) return { status: "not-found", entity: "access-grant" };
      if (input.quantity < grant.redeemed)
        return { status: "conflict", reason: "capacity_below_redeemed" };
      if (
        grant.fulfillmentMode === "single_use_codes" &&
        input.quantity < grant.quantity
      )
        return { status: "conflict", reason: "batch_capacity_reduction" };
      if (input.quantity === grant.quantity)
        return { status: "unchanged", accessGrantId: grant.id };
      if (
        grant.fulfillmentMode === "single_use_codes" &&
        input.quantity > grant.quantity
      )
        await issueGrantCodes(transaction, {
          accessGrantId: grant.id,
          prefix: grant.codePrefix ?? "ADDITIONAL-ACCESS",
          count: input.quantity - grant.quantity,
          firstOrdinal: grant.quantity + 1,
          createdAt: new Date(),
        });
      await transaction
        .updateTable("access_grant")
        .set({ quantity: input.quantity })
        .where("id", "=", grant.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "access_grant.administrator_capacity_updated",
        subjectType: "access_grant",
        subjectId: grant.id,
        metadata: {
          courseVersionId: grant.courseVersionId,
          organizationId: grant.organizationId,
          previousQuantity: grant.quantity,
          quantity: input.quantity,
          redeemed: grant.redeemed,
        },
      });
      return { status: "capacity-updated", accessGrantId: grant.id };
    });
}

type RevokeOutcome =
  | { status: "revoked" | "unchanged"; accessGrantId: string }
  | { status: "not-found"; entity: "access-grant" };

export async function revokeAdminAccessGrant(
  input: AdminAccessGrantRevokeInput,
  administrator: AuthenticatedUser,
): Promise<RevokeOutcome> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const grant = await transaction
        .selectFrom("access_grant")
        .select(["id", "courseVersionId", "organizationId", "revokedAt"])
        .where("id", "=", input.accessGrantId)
        .where("kind", "in", ["bulk_purchase", "enterprise_contract"])
        .forUpdate()
        .executeTakeFirst();
      if (!grant) return { status: "not-found", entity: "access-grant" };
      if (grant.revokedAt)
        return { status: "unchanged", accessGrantId: grant.id };
      const now = new Date();
      await transaction
        .updateTable("access_grant")
        .set({ revokedAt: now, revokedByUserId: administrator.id })
        .where("id", "=", grant.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "access_grant.administrator_revoked",
        subjectType: "access_grant",
        subjectId: grant.id,
        metadata: {
          courseVersionId: grant.courseVersionId,
          organizationId: grant.organizationId,
        },
        createdAt: now,
      });
      return { status: "revoked", accessGrantId: grant.id };
    });
}
