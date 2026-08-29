import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";
import { issueConfirmedEventRegistration } from "#/server/events/confirmed-event-registration.server";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";

interface FulfilmentResult {
  enrolledCount: number;
  skippedCount: number;
  eventRegisteredCount: number;
  eventSkippedCount: number;
}

const emptyResult = (): FulfilmentResult => ({
  enrolledCount: 0,
  skippedCount: 0,
  eventRegisteredCount: 0,
  eventSkippedCount: 0,
});

export async function enrollEnterpriseContractClaims(
  transaction: Transaction<Database>,
  enterpriseContractId: string,
  actorUserId: string,
  createdAt: Date,
  onlyClaimId?: string,
): Promise<FulfilmentResult> {
  const contract = await transaction
    .selectFrom("enterprise_contract")
    .select(["id", "status", "startsAt", "expiresAt", "enrollmentDurationDays"])
    .where("id", "=", enterpriseContractId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !contract ||
    contract.status !== "active" ||
    contract.startsAt > createdAt ||
    contract.expiresAt <= createdAt
  )
    return emptyResult();

  let claimQuery = transaction
    .selectFrom("enterprise_contract_claim as claim")
    .innerJoin("user as learner", "learner.id", "claim.userId")
    .select([
      "claim.id",
      "claim.userId",
      "claim.emailSnapshot",
      "claim.informationReleaseNoticeVersion",
      "claim.informationReleaseAcceptedAt",
      "learner.name",
      "learner.emailVerified",
    ])
    .where("claim.enterpriseContractId", "=", contract.id)
    .where("claim.revokedAt", "is", null);
  if (onlyClaimId) claimQuery = claimQuery.where("claim.id", "=", onlyClaimId);
  const claims = await claimQuery.execute();
  if (claims.length === 0) return emptyResult();

  const [courseCoverage, eventCoverage] = await Promise.all([
    transaction
      .selectFrom("enterprise_contract_course_coverage as coverage")
      .innerJoin("course", "course.id", "coverage.courseId")
      .innerJoin("course_version", "course_version.courseId", "course.id")
      .select([
        "coverage.id",
        "coverage.courseId",
        "course_version.id as courseVersionId",
      ])
      .where("coverage.enterpriseContractId", "=", contract.id)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .distinctOn("coverage.id")
      .orderBy("coverage.id")
      .orderBy("course_version.version", "desc")
      .execute(),
    transaction
      .selectFrom("enterprise_contract_event_coverage as coverage")
      .innerJoin(
        "event_occurrence as occurrence",
        "occurrence.id",
        "coverage.eventOccurrenceId",
      )
      .select([
        "coverage.id",
        "occurrence.id as eventOccurrenceId",
        "occurrence.registrationOpensAt",
        "occurrence.registrationClosesAt",
      ])
      .where("coverage.enterpriseContractId", "=", contract.id)
      .where("occurrence.status", "=", "published")
      .where("occurrence.startsAt", ">", createdAt)
      .orderBy("occurrence.startsAt")
      .execute(),
  ]);

  const result = emptyResult();
  const existingKeys = new Set<string>();
  if (courseCoverage.length > 0) {
    const existingEnrollments = await transaction
      .selectFrom("enrollment")
      .innerJoin(
        "course_version",
        "course_version.id",
        "enrollment.courseVersionId",
      )
      .select(["enrollment.userId", "course_version.courseId"])
      .where(
        "enrollment.userId",
        "in",
        claims.map((claim) => claim.userId),
      )
      .where(
        "course_version.courseId",
        "in",
        courseCoverage.map((item) => item.courseId),
      )
      .where("enrollment.removedAt", "is", null)
      .execute();
    for (const enrollment of existingEnrollments)
      existingKeys.add(`${enrollment.userId}\u0000${enrollment.courseId}`);
  }

  for (const claim of claims) {
    for (const item of courseCoverage) {
      const enrollmentKey = `${claim.userId}\u0000${item.courseId}`;
      if (existingKeys.has(enrollmentKey)) {
        result.skippedCount += 1;
        continue;
      }
      const issued = await issueCourseEntitlement(transaction, {
        userId: claim.userId,
        userEmail: claim.emailSnapshot,
        courseVersionId: item.courseVersionId,
        enrollmentDurationDays: contract.enrollmentDurationDays,
        enrollmentAccessGrantId: null,
        origin: {
          type: "enterprise_contract",
          enterpriseContractId: contract.id,
          enterpriseContractClaimId: claim.id,
          enterpriseContractCoverageId: item.id,
        },
        informationRelease: {
          noticeVersion: claim.informationReleaseNoticeVersion,
          acceptedAt: claim.informationReleaseAcceptedAt,
        },
        createdAt,
        eventSource: "enterprise-contract",
      });
      existingKeys.add(enrollmentKey);
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "enterprise_contract.entitlement_issued",
        subjectType: "entitlement",
        subjectId: issued.entitlementId,
        aggregateId: contract.id,
        metadata: {
          claimId: claim.id,
          coverageId: item.id,
          enrollmentId: issued.enrollmentId,
          bulk: !onlyClaimId,
        },
        createdAt,
      });
      result.enrolledCount += 1;
    }

    const user: AuthenticatedUser = {
      id: claim.userId,
      name: claim.name,
      email: claim.emailSnapshot,
      emailVerified: claim.emailVerified,
    };
    for (const item of eventCoverage) {
      if (
        (item.registrationOpensAt && item.registrationOpensAt > createdAt) ||
        (item.registrationClosesAt && item.registrationClosesAt <= createdAt)
      ) {
        result.eventSkippedCount += 1;
        continue;
      }
      const registration = await issueConfirmedEventRegistration(transaction, {
        eventOccurrenceId: item.eventOccurrenceId,
        user,
        source: "enterprise_contract",
        eligibilitySource: "enterprise_contract",
        createdAt,
      });
      if (registration.status !== "created") {
        result.eventSkippedCount += 1;
        continue;
      }
      const linkageId = `enterprise_contract_event_registration_${randomUUID()}`;
      await transaction
        .insertInto("enterprise_contract_event_registration")
        .values({
          id: linkageId,
          enterpriseContractId: contract.id,
          enterpriseContractClaimId: claim.id,
          enterpriseContractEventCoverageId: item.id,
          eventRegistrationId: registration.eventRegistrationId,
          userId: claim.userId,
          registeredAt: createdAt,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "enterprise_contract.event_registered",
        subjectType: "enterprise_contract_event_registration",
        subjectId: linkageId,
        aggregateId: contract.id,
        metadata: {
          claimId: claim.id,
          coverageId: item.id,
          eventOccurrenceId: item.eventOccurrenceId,
          eventRegistrationId: registration.eventRegistrationId,
          bulk: !onlyClaimId,
        },
        createdAt,
      });
      result.eventRegisteredCount += 1;
    }
  }
  return result;
}
