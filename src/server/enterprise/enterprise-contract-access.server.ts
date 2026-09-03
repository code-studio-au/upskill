import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  AccessCodePreviewResult,
  AccessCodeRedemptionResult,
} from "#/features/access/access-code.schema";
import { INFORMATION_RELEASE_NOTICE_VERSION } from "#/features/access/access-code.schema";
import type {
  EnterpriseCourseAccessResult,
  EnterpriseCourseEnrollmentResult,
  EnterpriseEventAccessResult,
  EnterpriseEventRegistrationResult,
} from "#/features/enterprise/enterprise-contract.schema";
import { encryptedAccessCodeMatches } from "#/server/access/access-code-encryption.server";
import {
  extractAccessCodeLookupId,
  normalizeAccessCode,
} from "#/server/access/access-code.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";
import { issueConfirmedEventRegistration } from "#/server/events/confirmed-event-registration.server";
import { enrollEnterpriseContractClaims } from "./enterprise-contract-enrollment.server";

const terminalEventRegistrationStatuses = new Set<
  Database["event_registration"]["status"]
>(["coordinator_declined", "not_selected", "withdrawn", "cancelled"]);

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  return separator <= 0 || separator === email.length - 1
    ? null
    : email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

async function resolveContractCode(
  database: Kysely<Database>,
  code: string,
  user: AuthenticatedUser,
  lock: boolean,
) {
  const normalizedCode = normalizeAccessCode(code);
  const lookupId = extractAccessCodeLookupId(code);
  if (!normalizedCode || !lookupId) return null;
  let query = database
    .selectFrom("enterprise_contract_code as code")
    .innerJoin(
      "enterprise_contract as contract",
      "contract.id",
      "code.enterpriseContractId",
    )
    .innerJoin("organization", "organization.id", "contract.organizationId")
    .select([
      "code.id as codeId",
      "code.lookupId",
      "code.encryptedAccessCode",
      "contract.id",
      "contract.name",
      "contract.status",
      "contract.startsAt",
      "contract.expiresAt",
      "contract.organizationId",
      "organization.name as organizationName",
    ])
    .where("code.lookupId", "=", lookupId)
    .where("code.revokedAt", "is", null);
  if (lock) query = query.forUpdate(["contract", "code"]);
  const contract = await query.executeTakeFirst();
  if (
    !contract ||
    !encryptedAccessCodeMatches({
      accessGrantId: contract.id,
      lookupId: contract.lookupId,
      encryptedAccessCode: contract.encryptedAccessCode,
      submittedAccessCode: normalizedCode,
    })
  )
    return null;
  const now = new Date();
  if (
    contract.status !== "active" ||
    contract.startsAt > now ||
    contract.expiresAt <= now ||
    !user.emailVerified
  )
    return null;
  const domain = emailDomain(user.email);
  if (!domain) return null;
  const eligibleDomain = await database
    .selectFrom("enterprise_contract_domain")
    .select("domain")
    .where("enterpriseContractId", "=", contract.id)
    .where("domain", "=", domain)
    .executeTakeFirst();
  const eligibleEmployee = await database
    .selectFrom("enterprise_contract_employee_eligibility")
    .select("id")
    .where("enterpriseContractId", "=", contract.id)
    .where("email", "=", user.email.toLocaleLowerCase("en-AU"))
    .where("removedAt", "is", null)
    .executeTakeFirst();
  return eligibleDomain || eligibleEmployee ? contract : null;
}

export async function previewEnterpriseContractCode(
  database: Kysely<Database>,
  code: string,
  user: AuthenticatedUser,
): Promise<AccessCodePreviewResult | null> {
  const contract = await resolveContractCode(database, code, user, false);
  if (!contract) return null;
  const claim = await database
    .selectFrom("enterprise_contract_claim")
    .select("id")
    .where("enterpriseContractId", "=", contract.id)
    .where("userId", "=", user.id)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  if (claim)
    return {
      status: "already-activated",
      offeringTitle: contract.name,
      offeringType: "catalogue",
    };
  return {
    status: "ready",
    offeringTitle: contract.name,
    offeringType: "catalogue",
    organizationName: contract.organizationName,
    accessKind: "enterprise_contract",
    noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
  };
}

export async function claimEnterpriseContractAccess(
  database: Transaction<Database>,
  input: {
    code: string;
    noticeVersion: typeof INFORMATION_RELEASE_NOTICE_VERSION;
  },
  user: AuthenticatedUser,
): Promise<AccessCodeRedemptionResult | null> {
  const contract = await resolveContractCode(database, input.code, user, true);
  if (!contract) return null;
  const now = new Date();
  const claimId = `enterprise_contract_claim_${randomUUID()}`;
  const claim = await database
    .insertInto("enterprise_contract_claim")
    .values({
      id: claimId,
      enterpriseContractId: contract.id,
      userId: user.id,
      emailSnapshot: user.email.toLocaleLowerCase("en-AU"),
      informationReleaseNoticeVersion: input.noticeVersion,
      informationReleaseAcceptedAt: now,
      claimedAt: now,
      revokedAt: null,
      revokedByUserId: null,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["enterpriseContractId", "userId"])
        .where("revokedAt", "is", null)
        .doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  if (!claim)
    return {
      status: "already-activated",
      offeringTitle: contract.name,
      offeringType: "catalogue",
    };
  await recordDurableAuditEvent(database, {
    actorUserId: user.id,
    action: "enterprise_contract.claimed",
    subjectType: "enterprise_contract_claim",
    subjectId: claim.id,
    aggregateId: contract.id,
    metadata: {
      organizationId: contract.organizationId,
      codeId: contract.codeId,
      noticeVersion: input.noticeVersion,
    },
    createdAt: now,
  });
  const autoEnroll = await database
    .selectFrom("enterprise_contract")
    .select("autoEnrollCourses")
    .where("id", "=", contract.id)
    .executeTakeFirstOrThrow();
  if (autoEnroll.autoEnrollCourses)
    await enrollEnterpriseContractClaims(
      database,
      contract.id,
      user.id,
      now,
      claim.id,
    );
  return {
    status: "activated",
    offeringTitle: contract.name,
    offeringType: "catalogue",
  };
}

async function resolveCourseAccess(
  database: Kysely<Database>,
  slug: string,
  user: AuthenticatedUser,
  lock: boolean,
) {
  const existing = await database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select("enrollment.id")
    .where("enrollment.userId", "=", user.id)
    .where("course.slug", "=", slug)
    .where("enrollment.removedAt", "is", null)
    .executeTakeFirst();
  if (existing) return { status: "already-enrolled" } as const;
  let query = database
    .selectFrom("enterprise_contract_claim as claim")
    .innerJoin(
      "enterprise_contract as contract",
      "contract.id",
      "claim.enterpriseContractId",
    )
    .innerJoin(
      "enterprise_contract_course_coverage as coverage",
      "coverage.enterpriseContractId",
      "contract.id",
    )
    .innerJoin("course", "course.id", "coverage.courseId")
    .innerJoin("course_version", "course_version.courseId", "course.id")
    .innerJoin("organization", "organization.id", "contract.organizationId")
    .select([
      "claim.id as claimId",
      "contract.id as contractId",
      "contract.name as contractName",
      "contract.enrollmentDurationDays",
      "contract.organizationId",
      "organization.name as organizationName",
      "coverage.id as coverageId",
      "course.title as courseTitle",
      "course_version.id as courseVersionId",
    ])
    .where("claim.userId", "=", user.id)
    .where("claim.revokedAt", "is", null)
    .where("contract.status", "=", "active")
    .where("contract.startsAt", "<=", new Date())
    .where("contract.expiresAt", ">", new Date())
    .where("course.slug", "=", slug)
    .where("course.status", "=", "published")
    .where("course_version.publishedAt", "is not", null)
    .orderBy("contract.expiresAt")
    .orderBy("course_version.version", "desc")
    .limit(1);
  if (lock) query = query.forUpdate(["claim", "contract", "coverage"]);
  const access = await query.executeTakeFirst();
  return access
    ? ({ status: "ready", access } as const)
    : ({ status: "unavailable" } as const);
}

export async function findEnterpriseCourseAccess(
  slug: string,
  user: AuthenticatedUser,
): Promise<EnterpriseCourseAccessResult> {
  const resolved = await resolveCourseAccess(getDatabase(), slug, user, false);
  if (resolved.status !== "ready") return resolved;
  return {
    status: "ready",
    enterpriseContractId: resolved.access.contractId,
    contractName: resolved.access.contractName,
    organizationName: resolved.access.organizationName,
  };
}

export async function enrollWithEnterpriseContract(
  slug: string,
  user: AuthenticatedUser,
): Promise<EnterpriseCourseEnrollmentResult> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`enterprise-course:${user.id}:${slug}`}, 0)
      )`.execute(transaction);
      const resolved = await resolveCourseAccess(transaction, slug, user, true);
      if (resolved.status !== "ready") return resolved;
      const now = new Date();
      const { enrollmentId, entitlementId } = await issueCourseEntitlement(
        transaction,
        {
          userId: user.id,
          userEmail: user.email,
          courseVersionId: resolved.access.courseVersionId,
          enrollmentDurationDays: resolved.access.enrollmentDurationDays,
          enrollmentAccessGrantId: null,
          origin: {
            type: "enterprise_contract",
            enterpriseContractId: resolved.access.contractId,
            enterpriseContractClaimId: resolved.access.claimId,
            enterpriseContractCoverageId: resolved.access.coverageId,
          },
          createdAt: now,
          eventSource: "enterprise-contract",
        },
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "enterprise_contract.entitlement_issued",
        subjectType: "entitlement",
        subjectId: entitlementId,
        aggregateId: resolved.access.contractId,
        metadata: {
          claimId: resolved.access.claimId,
          coverageId: resolved.access.coverageId,
          courseVersionId: resolved.access.courseVersionId,
          enrollmentId,
          organizationId: resolved.access.organizationId,
        },
        createdAt: now,
      });
      return {
        status: "enrolled",
        courseTitle: resolved.access.courseTitle,
        enrollmentId,
      } as const;
    });
}

async function resolveEventAccess(
  database: Kysely<Database>,
  slug: string,
  user: AuthenticatedUser,
  lock: boolean,
) {
  const existing = await database
    .selectFrom("event_registration")
    .innerJoin(
      "event_occurrence",
      "event_occurrence.id",
      "event_registration.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version",
      "event_template_version.id",
      "event_occurrence.eventTemplateVersionId",
    )
    .leftJoin(
      "registration_questionnaire_assignment as questionnaire",
      (join) =>
        join
          .onRef("questionnaire.eventOccurrenceId", "=", "event_occurrence.id")
          .on("questionnaire.userId", "=", user.id),
    )
    .leftJoin(
      "event_participation as participation",
      "participation.registrationId",
      "event_registration.id",
    )
    .select([
      "event_registration.id",
      "event_registration.status as registrationStatus",
      "event_occurrence.id as eventOccurrenceId",
      "event_template_version.registrationSurveyVersionId",
      "questionnaire.status as questionnaireStatus",
      "participation.id as eventParticipationId",
    ])
    .where("event_registration.userId", "=", user.id)
    .where("event_occurrence.slug", "=", slug)
    .executeTakeFirst();
  if (existing)
    return {
      status: "already-registered",
      eventOccurrenceId: existing.eventOccurrenceId,
      registrationRequired:
        Boolean(existing.registrationSurveyVersionId) &&
        !terminalEventRegistrationStatuses.has(existing.registrationStatus) &&
        existing.questionnaireStatus !== "completed" &&
        existing.questionnaireStatus !== "waived",
      canOpenEvent:
        existing.registrationStatus === "selected" &&
        existing.eventParticipationId !== null,
    } as const;
  let query = database
    .selectFrom("enterprise_contract_claim as claim")
    .innerJoin(
      "enterprise_contract as contract",
      "contract.id",
      "claim.enterpriseContractId",
    )
    .innerJoin(
      "enterprise_contract_event_coverage as coverage",
      "coverage.enterpriseContractId",
      "contract.id",
    )
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "coverage.eventOccurrenceId",
    )
    .innerJoin("organization", "organization.id", "contract.organizationId")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .leftJoin(
      "registration_questionnaire_assignment as questionnaire",
      (join) =>
        join
          .onRef("questionnaire.eventOccurrenceId", "=", "occurrence.id")
          .on("questionnaire.userId", "=", user.id),
    )
    .select([
      "claim.id as claimId",
      "contract.id as contractId",
      "contract.name as contractName",
      "contract.organizationId",
      "organization.name as organizationName",
      "coverage.id as coverageId",
      "occurrence.id as eventOccurrenceId",
      "version.registrationSurveyVersionId",
      "questionnaire.status as questionnaireStatus",
      "occurrence.registrationOpensAt",
      "occurrence.registrationClosesAt",
    ])
    .where("claim.userId", "=", user.id)
    .where("claim.revokedAt", "is", null)
    .where("contract.status", "=", "active")
    .where("contract.startsAt", "<=", new Date())
    .where("contract.expiresAt", ">", new Date())
    .where("occurrence.slug", "=", slug)
    .where("occurrence.status", "=", "published")
    .where("occurrence.startsAt", ">", new Date())
    .orderBy("contract.expiresAt")
    .limit(1);
  if (lock)
    query = query.forUpdate(["claim", "contract", "coverage", "occurrence"]);
  const access = await query.executeTakeFirst();
  const now = new Date();
  if (
    !access ||
    (access.registrationOpensAt && access.registrationOpensAt > now) ||
    (access.registrationClosesAt && access.registrationClosesAt <= now)
  )
    return { status: "unavailable" } as const;
  return { status: "ready", access } as const;
}

export async function findEnterpriseEventAccess(
  slug: string,
  user: AuthenticatedUser,
): Promise<EnterpriseEventAccessResult> {
  const result = await resolveEventAccess(getDatabase(), slug, user, false);
  if (result.status !== "ready") return result;
  return {
    status: "ready",
    contractName: result.access.contractName,
    organizationName: result.access.organizationName,
    eventOccurrenceId: result.access.eventOccurrenceId,
    registrationRequired:
      Boolean(result.access.registrationSurveyVersionId) &&
      result.access.questionnaireStatus !== "completed" &&
      result.access.questionnaireStatus !== "waived",
  };
}

export async function registerWithEnterpriseContract(
  slug: string,
  user: AuthenticatedUser,
): Promise<EnterpriseEventRegistrationResult> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`enterprise-event:${user.id}:${slug}`}, 0))`.execute(
        transaction,
      );
      const resolved = await resolveEventAccess(transaction, slug, user, true);
      if (resolved.status !== "ready") return resolved;
      const now = new Date();
      const registration = await issueConfirmedEventRegistration(transaction, {
        eventOccurrenceId: resolved.access.eventOccurrenceId,
        user,
        source: "enterprise_contract",
        eligibilitySource: "enterprise_contract",
        createdAt: now,
      });
      if (registration.status === "already-registered")
        return {
          status: "already-registered",
          eventOccurrenceId: resolved.access.eventOccurrenceId,
          registrationRequired:
            Boolean(resolved.access.registrationSurveyVersionId) &&
            !terminalEventRegistrationStatuses.has(
              registration.registrationStatus,
            ) &&
            resolved.access.questionnaireStatus !== "completed" &&
            resolved.access.questionnaireStatus !== "waived",
          canOpenEvent: registration.canOpenEvent,
        } as const;
      if (registration.status !== "created")
        return { status: "unavailable" } as const;
      const linkageId = `enterprise_contract_event_registration_${randomUUID()}`;
      await transaction
        .insertInto("enterprise_contract_event_registration")
        .values({
          id: linkageId,
          enterpriseContractId: resolved.access.contractId,
          enterpriseContractClaimId: resolved.access.claimId,
          enterpriseContractEventCoverageId: resolved.access.coverageId,
          eventRegistrationId: registration.eventRegistrationId,
          userId: user.id,
          registeredAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "enterprise_contract.event_registered",
        subjectType: "enterprise_contract_event_registration",
        subjectId: linkageId,
        aggregateId: resolved.access.contractId,
        metadata: {
          eventOccurrenceId: resolved.access.eventOccurrenceId,
          eventRegistrationId: registration.eventRegistrationId,
        },
        createdAt: now,
      });
      return {
        status: "registered",
        eventRegistrationId: registration.eventRegistrationId,
        eventOccurrenceId: resolved.access.eventOccurrenceId,
        registrationRequired:
          Boolean(resolved.access.registrationSurveyVersionId) &&
          resolved.access.questionnaireStatus !== "completed" &&
          resolved.access.questionnaireStatus !== "waived",
      } as const;
    });
}
