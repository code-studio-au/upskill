import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminAccessGrantCapacityInput,
  AdminAccessGrantCreateInput,
  AdminAccessGrantDirectory,
  AdminAccessGrantRevealInput,
  AdminAccessGrantRevokeInput,
} from "#/features/admin-access/admin-access.schema";
import { normalizeAdminAccessDomains } from "#/features/admin-access/admin-access.schema";
import {
  formatAccessCode,
  issueAccessCode,
} from "#/server/access/access-code.server";
import {
  decryptAccessCode,
  encryptAccessCode,
} from "#/server/access/access-code-encryption.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

const DIRECTORY_LIMIT = 100;
const REDEMPTIONS_PER_GRANT = 20;
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
  const [targets, grants] = await Promise.all([
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
      .selectFrom("access_grant")
      .innerJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .innerJoin("course", "course.id", "course_version.courseId")
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
        "organization.name as organizationName",
        "course.title as courseTitle",
        "course_version.version as courseVersion",
      ])
      .where("access_grant.encryptedAccessCode", "is not", null)
      .orderBy("access_grant.createdAt", "desc")
      .limit(DIRECTORY_LIMIT)
      .execute(),
  ]);

  const grantIds = grants.map((grant) => grant.id);
  if (grantIds.length === 0) return { targets, grants: [] };
  const [domainRows, enrollmentRows] = await Promise.all([
    database
      .selectFrom("access_grant_domain")
      .select(["accessGrantId", "domain"])
      .where("accessGrantId", "in", grantIds)
      .orderBy("domain")
      .execute(),
    database
      .selectFrom("enrollment")
      .innerJoin("user", "user.id", "enrollment.userId")
      .select([
        "enrollment.id as enrollmentId",
        "enrollment.accessGrantId",
        "enrollment.status",
        "enrollment.enrolledAt",
        "enrollment.completedAt",
        "enrollment.expiresAt",
        "enrollment.removedAt",
        "user.id as learnerId",
        "user.name as learnerName",
        "user.email as learnerEmail",
      ])
      .where("enrollment.accessGrantId", "in", grantIds)
      .orderBy("enrollment.enrolledAt", "desc")
      .execute(),
  ]);
  const domains = new Map<string, Array<string>>();
  for (const row of domainRows)
    domains.set(row.accessGrantId, [
      ...(domains.get(row.accessGrantId) ?? []),
      row.domain,
    ]);
  const redemptions = new Map<
    string,
    AdminAccessGrantDirectory["grants"][number]["redemptions"]
  >();
  for (const row of enrollmentRows) {
    if (!row.accessGrantId) continue;
    const current = redemptions.get(row.accessGrantId) ?? [];
    if (current.length >= REDEMPTIONS_PER_GRANT) continue;
    current.push({
      enrollmentId: row.enrollmentId,
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      learnerEmail: row.learnerEmail,
      enrolledAt: row.enrolledAt.toISOString(),
      state: accessState(row),
    });
    redemptions.set(row.accessGrantId, current);
  }

  return {
    targets,
    grants: grants.map((grant) => ({
      id: grant.id,
      label: grant.label ?? "Purchased access",
      organizationName: grant.organizationName,
      courseTitle: grant.courseTitle,
      courseVersion: grant.courseVersion,
      quantity: grant.quantity,
      redeemed: grant.redeemed,
      enrollmentDurationDays: grant.enrollmentDurationDays,
      domains: domains.get(grant.id) ?? [],
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      createdAt: grant.createdAt.toISOString(),
      redemptions: redemptions.get(grant.id) ?? [],
    })),
  };
}

type CreateOutcome =
  | { status: "created"; accessGrantId: string; accessCode: string }
  | { status: "not-found"; entity: "course-version" }
  | {
      status: "conflict";
      reason: "expiry_not_future";
    };

export async function createAdminAccessGrant(
  input: AdminAccessGrantCreateInput,
  administrator: AuthenticatedUser,
): Promise<CreateOutcome> {
  const expiresAt = input.expiresOn
    ? new Date(`${input.expiresOn}T23:59:59.999Z`)
    : null;
  const now = new Date();
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now))
    return { status: "conflict", reason: "expiry_not_future" };
  const domainRestrictions = normalizeAdminAccessDomains(input.domains);
  if (!domainRestrictions)
    throw new Error("Validated access-grant domains became invalid");
  const accessCode = formatAccessCode(input.accessCode);
  if (!accessCode)
    throw new Error("Validated administrator access code became invalid");

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const target = await transaction
        .selectFrom("course_version")
        .innerJoin("course", "course.id", "course_version.courseId")
        .select([
          "course_version.id",
          "course_version.version",
          "course.id as courseId",
        ])
        .where("course_version.id", "=", input.courseVersionId)
        .where("course_version.publishedAt", "is not", null)
        .where("course.status", "=", "published")
        .executeTakeFirst();
      if (!target) return { status: "not-found", entity: "course-version" };

      let issuedCode: ReturnType<typeof issueAccessCode> = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = issueAccessCode(accessCode);
        if (!candidate) throw new Error("Access-code issuance failed");
        await sql`select pg_advisory_xact_lock(
          hashtextextended(${`access-code-lookup:${candidate.lookupId}`}, 0)
        )`.execute(transaction);
        const duplicateLookup = await transaction
          .selectFrom("access_grant")
          .select("id")
          .where("accessCodeLookupId", "=", candidate.lookupId)
          .executeTakeFirst();
        if (!duplicateLookup) {
          issuedCode = candidate;
          break;
        }
      }
      if (!issuedCode)
        throw new Error("Unable to allocate a unique access-code lookup ID");

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
      const encryptedAccessCode = encryptAccessCode({
        accessGrantId,
        lookupId: issuedCode.lookupId,
        accessCode: issuedCode.accessCode,
      });
      await transaction
        .insertInto("access_grant")
        .values({
          id: accessGrantId,
          organizationId: organization.id,
          orderId: null,
          courseVersionId: target.id,
          accessCodeLookupId: issuedCode.lookupId,
          encryptedAccessCode,
          label: input.label.trim(),
          createdByUserId: administrator.id,
          enrollmentDurationDays: input.enrollmentDurationDays,
          quantity: input.quantity,
          redeemed: 0,
          expiresAt,
          revokedAt: null,
          revokedByUserId: null,
          createdAt: now,
        })
        .execute();
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
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "access_grant.administrator_created",
        subjectType: "access_grant",
        subjectId: accessGrantId,
        metadata: {
          courseId: target.courseId,
          courseVersionId: target.id,
          courseVersion: target.version,
          organizationId: organization.id,
          quantity: input.quantity,
          domainRestrictionCount: domainRestrictions.length,
        },
        createdAt: now,
      });
      return {
        status: "created",
        accessGrantId,
        accessCode: issuedCode.accessCode,
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
        .select([
          "id",
          "accessCodeLookupId",
          "encryptedAccessCode",
          "courseVersionId",
          "organizationId",
        ])
        .where("id", "=", input.accessGrantId)
        .where("encryptedAccessCode", "is not", null)
        .executeTakeFirst();
      if (!grant) return { status: "not-found", entity: "access-grant" };
      if (!grant.accessCodeLookupId || !grant.encryptedAccessCode)
        throw new Error("Selected access-code envelope was incomplete");
      const accessCode = decryptAccessCode({
        accessGrantId: grant.id,
        lookupId: grant.accessCodeLookupId,
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
  | { status: "conflict"; reason: "capacity_below_redeemed" };

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
        ])
        .where("id", "=", input.accessGrantId)
        .where("encryptedAccessCode", "is not", null)
        .forUpdate()
        .executeTakeFirst();
      if (!grant) return { status: "not-found", entity: "access-grant" };
      if (input.quantity < grant.redeemed)
        return { status: "conflict", reason: "capacity_below_redeemed" };
      if (input.quantity === grant.quantity)
        return { status: "unchanged", accessGrantId: grant.id };
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
        .where("encryptedAccessCode", "is not", null)
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
