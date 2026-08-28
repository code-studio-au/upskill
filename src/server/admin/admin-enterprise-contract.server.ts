import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  normalizeAccessOwnerEmails,
  normalizeAdminAccessDomains,
} from "#/features/admin-access/admin-access.schema";
import type {
  AdminEnterpriseContractBulkEnrollInput,
  AdminEnterpriseContractCreateInput,
  AdminEnterpriseContractDirectory,
  AdminEnterpriseContractEligibilityInput,
  AdminEnterpriseContractLifecycleInput,
  AdminEnterpriseContractOwnerInput,
  AdminEnterpriseContractRenewInput,
} from "#/features/admin-contract/admin-contract.schema";
import { issueAccessCode } from "#/server/access/access-code.server";
import {
  decryptAccessCode,
  encryptAccessCode,
} from "#/server/access/access-code-encryption.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { provisionUser } from "#/server/identity/provisional-user.server";
import { enrollEnterpriseContractClaims } from "#/server/enterprise/enterprise-contract-enrollment.server";
import {
  instantToDate,
  utcEndOfDate,
  utcStartOfDate,
} from "#/server/time/time.server";

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

function csvRows(value: string): Array<Array<string>> | null {
  const rows: Array<Array<string>> = [];
  let row: Array<string> = [];
  let cell = "";
  let quoted = false;
  const source = value.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      if (rows.length > 20_001) return null;
      row = [];
      cell = "";
    } else cell += character ?? "";
  }
  if (quoted) return null;
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseEmployeeCsv(
  value: string,
): Array<{ email: string; name: string | null }> | null {
  const rows = csvRows(value);
  if (!rows) return null;
  if (rows.length === 0 || rows.length > 20_001) return null;
  const first = rows[0]?.map((cell) => cell.toLocaleLowerCase("en-AU")) ?? [];
  const hasHeader = first.includes("email");
  const emailIndex = hasHeader ? first.indexOf("email") : 0;
  const nameIndex = hasHeader ? first.indexOf("name") : 1;
  const entries = new Map<string, { email: string; name: string | null }>();
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const email = (row[emailIndex] ?? "").toLocaleLowerCase("en-AU");
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u.test(email)) return null;
    const name = nameIndex >= 0 ? row[nameIndex]?.trim() || null : null;
    if (name && name.length > 160) return null;
    entries.set(email, { email, name });
  }
  return entries.size > 0 ? [...entries.values()] : null;
}

function contractState(row: {
  status: "draft" | "active" | "suspended" | "terminated";
  expiresAt: Date;
}): "draft" | "active" | "suspended" | "expired" | "terminated" {
  if (row.status !== "draft" && row.status !== "terminated") {
    if (row.expiresAt <= new Date()) return "expired";
  }
  return row.status;
}

async function issueContractCode(
  transaction: Transaction<Database>,
  enterpriseContractId: string,
  prefix: string,
  administratorId: string,
  createdAt: Date,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = issueAccessCode(prefix);
    if (!candidate) throw new Error("Enterprise access-code issuance failed");
    const [grantCollision, contractCollision] = await Promise.all([
      transaction
        .selectFrom("access_grant_code")
        .select("id")
        .where("lookupId", "=", candidate.lookupId)
        .executeTakeFirst(),
      transaction
        .selectFrom("enterprise_contract_code")
        .select("id")
        .where("lookupId", "=", candidate.lookupId)
        .executeTakeFirst(),
    ]);
    if (grantCollision || contractCollision) continue;
    await transaction
      .insertInto("enterprise_contract_code")
      .values({
        id: `enterprise_contract_code_${randomUUID()}`,
        enterpriseContractId,
        lookupId: candidate.lookupId,
        encryptedAccessCode: encryptAccessCode({
          accessCode: candidate.accessCode,
          accessGrantId: enterpriseContractId,
          lookupId: candidate.lookupId,
        }),
        createdByUserId: administratorId,
        createdAt,
        revokedAt: null,
        revokedByUserId: null,
      })
      .execute();
    return candidate.accessCode;
  }
  throw new Error("Could not allocate a unique enterprise access code");
}

async function assignContractOwners(
  transaction: Transaction<Database>,
  input: {
    enterpriseContractId: string;
    ownerEmails: ReadonlyArray<string>;
    administrator: AuthenticatedUser;
    createdAt: Date;
  },
): Promise<number> {
  let assigned = 0;
  for (const ownerEmail of input.ownerEmails) {
    const existing = await transaction
      .selectFrom("enterprise_contract_owner_assignment")
      .select("id")
      .where("enterpriseContractId", "=", input.enterpriseContractId)
      .where("invitedEmail", "=", ownerEmail)
      .where("revokedAt", "is", null)
      .executeTakeFirst();
    if (existing) continue;
    const assignmentId = `enterprise_contract_owner_${randomUUID()}`;
    const provisioned = await provisionUser(transaction, {
      name:
        ownerEmail.split("@")[0]?.replaceAll(/[._-]+/gu, " ") ??
        "Contract Access Owner",
      email: ownerEmail,
      source: "access_owner",
      actorUserId: input.administrator.id,
      sourceEventId: assignmentId,
      createdAt: input.createdAt,
    });
    const activatedAt =
      provisioned.user.accountState === "active" &&
      provisioned.user.emailVerified
        ? input.createdAt
        : null;
    await transaction
      .insertInto("enterprise_contract_owner_assignment")
      .values({
        id: assignmentId,
        enterpriseContractId: input.enterpriseContractId,
        userId: provisioned.user.id,
        invitedEmail: ownerEmail,
        invitedByUserId: input.administrator.id,
        invitedAt: input.createdAt,
        activatedAt,
        revokedAt: null,
        revokedByUserId: null,
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: input.administrator.id,
      action: "enterprise_contract.owner_assigned",
      subjectType: "enterprise_contract_owner_assignment",
      subjectId: assignmentId,
      aggregateId: input.enterpriseContractId,
      metadata: { ownerUserId: provisioned.user.id },
      createdAt: input.createdAt,
    });
    assigned += 1;
  }
  return assigned;
}

export async function findAdminEnterpriseContracts(): Promise<AdminEnterpriseContractDirectory> {
  const database = getDatabase();
  const [courses, events, contracts] = await Promise.all([
    database
      .selectFrom("course")
      .innerJoin("course_version", "course_version.courseId", "course.id")
      .select([
        "course.id",
        "course.title",
        sql<number>`max(course_version.version)::integer`.as("version"),
      ])
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .groupBy(["course.id", "course.title"])
      .orderBy("course.title")
      .execute(),
    database
      .selectFrom("event_occurrence")
      .select([
        "id",
        "title",
        "startsAt",
        "timezone",
        "capacity",
        "confirmedCount",
      ])
      .where("status", "=", "published")
      .where("startsAt", ">", new Date())
      .orderBy("startsAt")
      .limit(300)
      .execute(),
    database
      .selectFrom("enterprise_contract as contract")
      .innerJoin("organization", "organization.id", "contract.organizationId")
      .select([
        "contract.id",
        "contract.name",
        "contract.reference",
        "contract.status",
        "contract.startsAt",
        "contract.expiresAt",
        "contract.enrollmentDurationDays",
        "contract.autoEnrollCourses",
        "contract.renewedFromEnterpriseContractId",
        sql<string | null>`(
          select renewal.id from enterprise_contract renewal
          where renewal."renewedFromEnterpriseContractId" = contract.id
          limit 1
        )`.as("renewalContractId"),
        "contract.createdAt",
        "organization.name as organizationName",
        sql<number>`(
          select count(*)::integer from enterprise_contract_claim claim
          where claim."enterpriseContractId" = contract.id and claim."revokedAt" is null
        )`.as("claimCount"),
        sql<number>`(
          select count(*)::integer from entitlement
          where entitlement."originEnterpriseContractId" = contract.id
        )`.as("entitlementCount"),
        sql<number>`(
          select count(*)::integer from enterprise_contract_employee_eligibility employee
          where employee."enterpriseContractId" = contract.id and employee."removedAt" is null
        )`.as("employeeEligibilityCount"),
      ])
      .orderBy("contract.createdAt", "desc")
      .limit(100)
      .execute(),
  ]);
  const contractIds = contracts.map((contract) => contract.id);
  const [coverageRows, eventCoverageRows, domainRows, ownerRows] =
    contractIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          database
            .selectFrom("enterprise_contract_course_coverage")
            .select([
              "id",
              "enterpriseContractId",
              "courseId",
              "courseTitleSnapshot",
            ])
            .where("enterpriseContractId", "in", contractIds)
            .orderBy("courseTitleSnapshot")
            .execute(),
          database
            .selectFrom("enterprise_contract_event_coverage")
            .select([
              "id",
              "enterpriseContractId",
              "eventOccurrenceId",
              "eventTitleSnapshot",
            ])
            .where("enterpriseContractId", "in", contractIds)
            .orderBy("eventTitleSnapshot")
            .execute(),
          database
            .selectFrom("enterprise_contract_domain")
            .select(["enterpriseContractId", "domain"])
            .where("enterpriseContractId", "in", contractIds)
            .orderBy("domain")
            .execute(),
          database
            .selectFrom("enterprise_contract_owner_assignment")
            .select([
              "id",
              "enterpriseContractId",
              "invitedEmail",
              "activatedAt",
            ])
            .where("enterpriseContractId", "in", contractIds)
            .where("revokedAt", "is", null)
            .orderBy("invitedEmail")
            .execute(),
        ]);
  const coverageByContract = new Map<
    string,
    AdminEnterpriseContractDirectory["contracts"][number]["coverage"]
  >();
  for (const coverage of coverageRows) {
    const entries = coverageByContract.get(coverage.enterpriseContractId) ?? [];
    entries.push({
      id: coverage.id,
      courseId: coverage.courseId,
      courseTitle: coverage.courseTitleSnapshot,
    });
    coverageByContract.set(coverage.enterpriseContractId, entries);
  }
  const domainsByContract = new Map<string, Array<string>>();
  for (const domain of domainRows) {
    const entries = domainsByContract.get(domain.enterpriseContractId) ?? [];
    entries.push(domain.domain);
    domainsByContract.set(domain.enterpriseContractId, entries);
  }
  const eventsByContract = new Map<
    string,
    AdminEnterpriseContractDirectory["contracts"][number]["eventCoverage"]
  >();
  for (const coverage of eventCoverageRows) {
    const entries = eventsByContract.get(coverage.enterpriseContractId) ?? [];
    entries.push({
      id: coverage.id,
      eventOccurrenceId: coverage.eventOccurrenceId,
      eventTitle: coverage.eventTitleSnapshot,
    });
    eventsByContract.set(coverage.enterpriseContractId, entries);
  }
  const ownersByContract = new Map<
    string,
    AdminEnterpriseContractDirectory["contracts"][number]["owners"]
  >();
  for (const owner of ownerRows) {
    const entries = ownersByContract.get(owner.enterpriseContractId) ?? [];
    entries.push({
      id: owner.id,
      email: owner.invitedEmail,
      activated: owner.activatedAt !== null,
    });
    ownersByContract.set(owner.enterpriseContractId, entries);
  }
  return {
    courses,
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      remainingPlaces: Math.max(0, event.capacity - event.confirmedCount),
    })),
    contracts: contracts.map((contract) => ({
      id: contract.id,
      name: contract.name,
      reference: contract.reference,
      organizationName: contract.organizationName,
      status: contractState(contract),
      startsAt: contract.startsAt.toISOString(),
      expiresAt: contract.expiresAt.toISOString(),
      enrollmentDurationDays: contract.enrollmentDurationDays,
      autoEnrollCourses: contract.autoEnrollCourses,
      renewedFromEnterpriseContractId: contract.renewedFromEnterpriseContractId,
      renewalContractId: contract.renewalContractId,
      coverage: coverageByContract.get(contract.id) ?? [],
      eventCoverage: eventsByContract.get(contract.id) ?? [],
      domains: domainsByContract.get(contract.id) ?? [],
      employeeEligibilityCount: contract.employeeEligibilityCount,
      owners: ownersByContract.get(contract.id) ?? [],
      claimCount: contract.claimCount,
      entitlementCount: contract.entitlementCount,
      createdAt: contract.createdAt.toISOString(),
    })),
  };
}

export async function createAdminEnterpriseContract(
  input: AdminEnterpriseContractCreateInput,
  administrator: AuthenticatedUser,
) {
  const domains = normalizeAdminAccessDomains(input.domains);
  if (!domains) throw new Error("Validated contract domains invalid");
  const uniqueCourseIds = [...new Set(input.courseIds)];
  const uniqueEventIds = [...new Set(input.eventOccurrenceIds)];
  const startsAt = instantToDate(utcStartOfDate(input.startsOn));
  const expiresAt = instantToDate(utcEndOfDate(input.expiresOn));
  const createdAt = new Date();
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const normalizedReference = input.reference
        .trim()
        .toLocaleLowerCase("en-AU");
      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`enterprise-contract-reference:${normalizedReference}`}, 0)
      )`.execute(transaction);
      const duplicate = await transaction
        .selectFrom("enterprise_contract")
        .select("id")
        .where(sql<boolean>`lower(reference) = ${normalizedReference}`)
        .executeTakeFirst();
      if (duplicate)
        return { status: "conflict", reason: "duplicate_reference" } as const;
      const courses = await transaction
        .selectFrom("course")
        .innerJoin("course_version", "course_version.courseId", "course.id")
        .select(["course.id", "course.title"])
        .distinctOn("course.id")
        .where("course.id", "in", uniqueCourseIds)
        .where("course.status", "=", "published")
        .where("course_version.publishedAt", "is not", null)
        .orderBy("course.id")
        .orderBy("course_version.version", "desc")
        .execute();
      if (courses.length !== uniqueCourseIds.length)
        return { status: "conflict", reason: "offering_unavailable" } as const;
      const events =
        uniqueEventIds.length === 0
          ? []
          : await transaction
              .selectFrom("event_occurrence")
              .select(["id", "title"])
              .where("id", "in", uniqueEventIds)
              .where("status", "=", "published")
              .where("startsAt", ">", createdAt)
              .execute();
      if (events.length !== uniqueEventIds.length)
        return { status: "conflict", reason: "offering_unavailable" } as const;

      const organizationName = input.organizationName.trim();
      const organizationLock = organizationName.toLocaleLowerCase("en-AU");
      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`contract-organisation:${organizationLock}`}, 0)
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
            createdAt,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      }

      const enterpriseContractId = `enterprise_contract_${randomUUID()}`;
      await transaction
        .insertInto("enterprise_contract")
        .values({
          id: enterpriseContractId,
          organizationId: organization.id,
          reference: input.reference.trim(),
          name: input.name.trim(),
          status: "draft",
          startsAt,
          expiresAt,
          enrollmentDurationDays: input.enrollmentDurationDays,
          autoEnrollCourses: input.autoEnrollCourses,
          renewedFromEnterpriseContractId: null,
          createdByUserId: administrator.id,
          createdAt,
          activatedAt: null,
          suspendedAt: null,
          terminatedAt: null,
          terminatedByUserId: null,
        })
        .execute();
      if (events.length > 0)
        await transaction
          .insertInto("enterprise_contract_event_coverage")
          .values(
            events.map((event) => ({
              id: `enterprise_contract_event_coverage_${randomUUID()}`,
              enterpriseContractId,
              eventOccurrenceId: event.id,
              eventTitleSnapshot: event.title,
              createdAt,
            })),
          )
          .execute();
      if (courses.length > 0)
        await transaction
          .insertInto("enterprise_contract_course_coverage")
          .values(
            courses.map((course) => ({
              id: `enterprise_contract_coverage_${randomUUID()}`,
              enterpriseContractId,
              courseId: course.id,
              courseTitleSnapshot: course.title,
              createdAt,
            })),
          )
          .execute();
      if (domains.length > 0)
        await transaction
          .insertInto("enterprise_contract_domain")
          .values(
            domains.map((domain) => ({
              enterpriseContractId,
              domain,
              createdAt,
            })),
          )
          .execute();
      const accessCode = await issueContractCode(
        transaction,
        enterpriseContractId,
        input.accessCode,
        administrator.id,
        createdAt,
      );
      const ownerEmails =
        input.ownerEmails.trim() === ""
          ? []
          : (normalizeAccessOwnerEmails(input.ownerEmails) ?? []);
      await assignContractOwners(transaction, {
        enterpriseContractId,
        ownerEmails,
        administrator,
        createdAt,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.created",
        subjectType: "enterprise_contract",
        subjectId: enterpriseContractId,
        metadata: {
          organizationId: organization.id,
          reference: input.reference.trim(),
          coverageCount: courses.length,
          eventCoverageCount: events.length,
          domainCount: domains.length,
          ownerCount: ownerEmails.length,
          autoEnrollCourses: input.autoEnrollCourses,
        },
        createdAt,
      });
      return {
        status: "created",
        enterpriseContractId,
        accessCode,
      } as const;
    });
}

export async function transitionAdminEnterpriseContract(
  input: AdminEnterpriseContractLifecycleInput,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const contract = await transaction
        .selectFrom("enterprise_contract")
        .select(["id", "status", "expiresAt", "organizationId"])
        .where("id", "=", input.enterpriseContractId)
        .forUpdate()
        .executeTakeFirst();
      if (!contract) return { status: "not-found" } as const;
      const now = new Date();
      if (input.action === "activate") {
        const eligibility = await transaction
          .selectFrom("enterprise_contract")
          .select([
            sql<number>`(select count(*)::integer from enterprise_contract_domain where "enterpriseContractId" = ${contract.id})`.as(
              "domainCount",
            ),
            sql<number>`(select count(*)::integer from enterprise_contract_employee_eligibility where "enterpriseContractId" = ${contract.id} and "removedAt" is null)`.as(
              "employeeCount",
            ),
          ])
          .where("id", "=", contract.id)
          .executeTakeFirstOrThrow();
        if (eligibility.domainCount + eligibility.employeeCount === 0)
          return {
            status: "conflict",
            reason: "eligibility_required",
          } as const;
      }
      if (input.action !== "terminate" && contract.expiresAt <= now)
        return { status: "conflict", reason: "period_expired" } as const;
      const allowed =
        (input.action === "activate" && contract.status === "draft") ||
        (input.action === "suspend" && contract.status === "active") ||
        (input.action === "resume" && contract.status === "suspended") ||
        (input.action === "terminate" && contract.status !== "terminated");
      if (!allowed)
        return { status: "conflict", reason: "invalid_transition" } as const;
      const nextStatus =
        input.action === "activate" || input.action === "resume"
          ? "active"
          : input.action === "suspend"
            ? "suspended"
            : "terminated";
      await transaction
        .updateTable("enterprise_contract")
        .set({
          status: nextStatus,
          activatedAt: input.action === "activate" ? now : undefined,
          suspendedAt: input.action === "suspend" ? now : null,
          terminatedAt: input.action === "terminate" ? now : null,
          terminatedByUserId:
            input.action === "terminate" ? administrator.id : null,
        })
        .where("id", "=", contract.id)
        .executeTakeFirstOrThrow();
      const auditAction =
        input.action === "activate"
          ? "enterprise_contract.activated"
          : input.action === "suspend"
            ? "enterprise_contract.suspended"
            : input.action === "resume"
              ? "enterprise_contract.resumed"
              : "enterprise_contract.terminated";
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: auditAction,
        subjectType: "enterprise_contract",
        subjectId: contract.id,
        metadata: {
          organizationId: contract.organizationId,
          previousStatus: contract.status,
          status: nextStatus,
        },
        createdAt: now,
      });
      return {
        status:
          input.action === "activate"
            ? "activated"
            : input.action === "suspend"
              ? "suspended"
              : input.action === "resume"
                ? "resumed"
                : "terminated",
        enterpriseContractId: contract.id,
      } as const;
    });
}

export async function revealAdminEnterpriseContractCode(
  enterpriseContractId: string,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const code = await transaction
        .selectFrom("enterprise_contract_code as code")
        .innerJoin(
          "enterprise_contract as contract",
          "contract.id",
          "code.enterpriseContractId",
        )
        .select([
          "code.lookupId",
          "code.encryptedAccessCode",
          "contract.id",
          "contract.organizationId",
        ])
        .where("contract.id", "=", enterpriseContractId)
        .where("code.revokedAt", "is", null)
        .executeTakeFirst();
      if (!code) return { status: "not-found" } as const;
      const accessCode = decryptAccessCode({
        accessGrantId: enterpriseContractId,
        lookupId: code.lookupId,
        encryptedAccessCode: code.encryptedAccessCode,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.code_revealed",
        subjectType: "enterprise_contract",
        subjectId: code.id,
        metadata: { organizationId: code.organizationId },
      });
      return {
        status: "ready",
        enterpriseContractId,
        accessCode,
      } as const;
    });
}

export async function rotateAdminEnterpriseContractCode(
  input: { enterpriseContractId: string; accessCode: string },
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const contract = await transaction
        .selectFrom("enterprise_contract")
        .select(["id", "organizationId", "status"])
        .where("id", "=", input.enterpriseContractId)
        .forUpdate()
        .executeTakeFirst();
      if (!contract) return { status: "not-found" } as const;
      if (contract.status === "terminated")
        return { status: "conflict", reason: "invalid_transition" } as const;
      const now = new Date();
      const revoked = await transaction
        .updateTable("enterprise_contract_code")
        .set({ revokedAt: now, revokedByUserId: administrator.id })
        .where("enterpriseContractId", "=", contract.id)
        .where("revokedAt", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!revoked)
        return { status: "conflict", reason: "no_active_code" } as const;
      const accessCode = await issueContractCode(
        transaction,
        contract.id,
        input.accessCode,
        administrator.id,
        now,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.code_rotated",
        subjectType: "enterprise_contract_code",
        subjectId: revoked.id,
        aggregateId: contract.id,
        metadata: { organizationId: contract.organizationId },
        createdAt: now,
      });
      return {
        status: "code_rotated",
        enterpriseContractId: contract.id,
        accessCode,
      } as const;
    });
}

export async function renewAdminEnterpriseContract(
  input: AdminEnterpriseContractRenewInput,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const source = await transaction
        .selectFrom("enterprise_contract")
        .selectAll()
        .where("id", "=", input.enterpriseContractId)
        .forUpdate()
        .executeTakeFirst();
      if (!source) return { status: "not-found" } as const;
      const existing = await transaction
        .selectFrom("enterprise_contract")
        .select("id")
        .where("renewedFromEnterpriseContractId", "=", source.id)
        .executeTakeFirst();
      if (existing)
        return { status: "conflict", reason: "renewal_exists" } as const;
      const normalizedReference = input.reference
        .trim()
        .toLocaleLowerCase("en-AU");
      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`enterprise-contract-reference:${normalizedReference}`}, 0)
      )`.execute(transaction);
      const duplicate = await transaction
        .selectFrom("enterprise_contract")
        .select("id")
        .where(sql<boolean>`lower(reference) = ${normalizedReference}`)
        .executeTakeFirst();
      if (duplicate)
        return { status: "conflict", reason: "duplicate_reference" } as const;
      const now = new Date();
      const enterpriseContractId = `enterprise_contract_${randomUUID()}`;
      await transaction
        .insertInto("enterprise_contract")
        .values({
          id: enterpriseContractId,
          organizationId: source.organizationId,
          reference: input.reference.trim(),
          name: input.name.trim(),
          status: "draft",
          startsAt: instantToDate(utcStartOfDate(input.startsOn)),
          expiresAt: instantToDate(utcEndOfDate(input.expiresOn)),
          enrollmentDurationDays: source.enrollmentDurationDays,
          autoEnrollCourses: source.autoEnrollCourses,
          renewedFromEnterpriseContractId: source.id,
          createdByUserId: administrator.id,
          createdAt: now,
          activatedAt: null,
          suspendedAt: null,
          terminatedAt: null,
          terminatedByUserId: null,
        })
        .execute();
      const [courses, events, domains, employees, owners] = await Promise.all([
        transaction
          .selectFrom("enterprise_contract_course_coverage")
          .select(["courseId", "courseTitleSnapshot"])
          .where("enterpriseContractId", "=", source.id)
          .execute(),
        transaction
          .selectFrom("enterprise_contract_event_coverage as coverage")
          .innerJoin(
            "event_occurrence as occurrence",
            "occurrence.id",
            "coverage.eventOccurrenceId",
          )
          .select(["coverage.eventOccurrenceId", "coverage.eventTitleSnapshot"])
          .where("coverage.enterpriseContractId", "=", source.id)
          .where("occurrence.status", "=", "published")
          .where("occurrence.startsAt", ">", now)
          .execute(),
        transaction
          .selectFrom("enterprise_contract_domain")
          .select("domain")
          .where("enterpriseContractId", "=", source.id)
          .execute(),
        transaction
          .selectFrom("enterprise_contract_employee_eligibility")
          .select(["email", "name"])
          .where("enterpriseContractId", "=", source.id)
          .where("removedAt", "is", null)
          .execute(),
        transaction
          .selectFrom("enterprise_contract_owner_assignment")
          .select("invitedEmail")
          .where("enterpriseContractId", "=", source.id)
          .where("revokedAt", "is", null)
          .execute(),
      ]);
      if (courses.length)
        await transaction
          .insertInto("enterprise_contract_course_coverage")
          .values(
            courses.map((course) => ({
              id: `enterprise_contract_coverage_${randomUUID()}`,
              enterpriseContractId,
              ...course,
              createdAt: now,
            })),
          )
          .execute();
      if (events.length)
        await transaction
          .insertInto("enterprise_contract_event_coverage")
          .values(
            events.map((event) => ({
              id: `enterprise_contract_event_coverage_${randomUUID()}`,
              enterpriseContractId,
              ...event,
              createdAt: now,
            })),
          )
          .execute();
      if (domains.length)
        await transaction
          .insertInto("enterprise_contract_domain")
          .values(
            domains.map(({ domain }) => ({
              enterpriseContractId,
              domain,
              createdAt: now,
            })),
          )
          .execute();
      if (employees.length)
        await transaction
          .insertInto("enterprise_contract_employee_eligibility")
          .values(
            employees.map((employee) => ({
              id: `enterprise_contract_employee_${randomUUID()}`,
              enterpriseContractId,
              ...employee,
              importedByUserId: administrator.id,
              importedAt: now,
              removedAt: null,
              removedByUserId: null,
            })),
          )
          .execute();
      await assignContractOwners(transaction, {
        enterpriseContractId,
        ownerEmails: owners.map((owner) => owner.invitedEmail),
        administrator,
        createdAt: now,
      });
      const accessCode = await issueContractCode(
        transaction,
        enterpriseContractId,
        input.accessCode,
        administrator.id,
        now,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.renewed",
        subjectType: "enterprise_contract",
        subjectId: enterpriseContractId,
        aggregateId: source.id,
        metadata: { sourceContractId: source.id },
        createdAt: now,
      });
      return { status: "renewed", enterpriseContractId, accessCode } as const;
    });
}

export async function replaceAdminEnterpriseContractEligibility(
  input: AdminEnterpriseContractEligibilityInput,
  administrator: AuthenticatedUser,
) {
  const employees = parseEmployeeCsv(input.csvText);
  if (!employees) return { status: "conflict", reason: "invalid_csv" } as const;
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const contract = await transaction
        .selectFrom("enterprise_contract")
        .select(["id", "status"])
        .where("id", "=", input.enterpriseContractId)
        .forUpdate()
        .executeTakeFirst();
      if (!contract) return { status: "not-found" } as const;
      if (contract.status === "terminated")
        return { status: "conflict", reason: "invalid_transition" } as const;
      const now = new Date();
      await transaction
        .updateTable("enterprise_contract_employee_eligibility")
        .set({ removedAt: now, removedByUserId: administrator.id })
        .where("enterpriseContractId", "=", contract.id)
        .where("removedAt", "is", null)
        .execute();
      await transaction
        .insertInto("enterprise_contract_employee_eligibility")
        .values(
          employees.map((employee) => ({
            id: `enterprise_contract_employee_${randomUUID()}`,
            enterpriseContractId: contract.id,
            ...employee,
            importedByUserId: administrator.id,
            importedAt: now,
            removedAt: null,
            removedByUserId: null,
          })),
        )
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.eligibility_replaced",
        subjectType: "enterprise_contract",
        subjectId: contract.id,
        metadata: { importedCount: employees.length },
        createdAt: now,
      });
      return {
        status: "eligibility_replaced",
        enterpriseContractId: contract.id,
        importedCount: employees.length,
      } as const;
    });
}

export async function assignAdminEnterpriseContractOwners(
  input: AdminEnterpriseContractOwnerInput,
  administrator: AuthenticatedUser,
) {
  const ownerEmails = normalizeAccessOwnerEmails(input.ownerEmails);
  if (!ownerEmails)
    return { status: "conflict", reason: "invalid_owner_emails" } as const;
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const contract = await transaction
        .selectFrom("enterprise_contract")
        .select(["id", "status"])
        .where("id", "=", input.enterpriseContractId)
        .forUpdate()
        .executeTakeFirst();
      if (!contract) return { status: "not-found" } as const;
      if (contract.status === "terminated")
        return { status: "conflict", reason: "invalid_transition" } as const;
      await assignContractOwners(transaction, {
        enterpriseContractId: contract.id,
        ownerEmails,
        administrator,
        createdAt: new Date(),
      });
      return {
        status: "owners_assigned",
        enterpriseContractId: contract.id,
      } as const;
    });
}

export async function revokeAdminEnterpriseContractOwner(
  input: { enterpriseContractId: string; ownerAssignmentId: string },
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const owner = await transaction
        .updateTable("enterprise_contract_owner_assignment")
        .set({ revokedAt: now, revokedByUserId: administrator.id })
        .where("id", "=", input.ownerAssignmentId)
        .where("enterpriseContractId", "=", input.enterpriseContractId)
        .where("revokedAt", "is", null)
        .returning(["id", "userId"])
        .executeTakeFirst();
      if (!owner) return { status: "not-found" } as const;
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.owner_revoked",
        subjectType: "enterprise_contract_owner_assignment",
        subjectId: owner.id,
        aggregateId: input.enterpriseContractId,
        metadata: { ownerUserId: owner.userId },
        createdAt: now,
      });
      return {
        status: "owner_revoked",
        enterpriseContractId: input.enterpriseContractId,
      } as const;
    });
}

export async function bulkEnrollAdminEnterpriseContract(
  input: AdminEnterpriseContractBulkEnrollInput,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const contract = await transaction
        .selectFrom("enterprise_contract")
        .select("id")
        .where("id", "=", input.enterpriseContractId)
        .executeTakeFirst();
      if (!contract) return { status: "not-found" } as const;
      const [claims, coverage] = await Promise.all([
        transaction
          .selectFrom("enterprise_contract_claim")
          .select((expression) => expression.fn.countAll<number>().as("count"))
          .where("enterpriseContractId", "=", contract.id)
          .where("revokedAt", "is", null)
          .executeTakeFirstOrThrow(),
        transaction
          .selectFrom("enterprise_contract_course_coverage")
          .select((expression) => expression.fn.countAll<number>().as("count"))
          .where("enterpriseContractId", "=", contract.id)
          .executeTakeFirstOrThrow(),
      ]);
      if (claims.count * coverage.count > 5_000)
        return { status: "conflict", reason: "bulk_too_large" } as const;
      const result = await enrollEnterpriseContractClaims(
        transaction,
        contract.id,
        administrator.id,
        now,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.bulk_enrollment_completed",
        subjectType: "enterprise_contract",
        subjectId: contract.id,
        metadata: result,
        createdAt: now,
      });
      return {
        status: "bulk_enrollment_completed",
        enterpriseContractId: contract.id,
        ...result,
      } as const;
    });
}

export async function findAdminEnterpriseContractUtilisationReport(
  enterpriseContractId: string,
  administrator: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const { findEnterpriseContractUtilisationReport } =
        await import("#/server/enterprise/enterprise-contract-report.server");
      const report = await findEnterpriseContractUtilisationReport(
        transaction,
        enterpriseContractId,
      );
      if (!report) return null;
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enterprise_contract.report_exported",
        subjectType: "enterprise_contract",
        subjectId: enterpriseContractId,
        metadata: { format: "csv", administrator: true },
      });
      return report;
    });
}
