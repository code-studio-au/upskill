import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";

export async function enrollEnterpriseContractClaims(
  transaction: Transaction<Database>,
  enterpriseContractId: string,
  actorUserId: string,
  createdAt: Date,
  onlyClaimId?: string,
): Promise<{ enrolledCount: number; skippedCount: number }> {
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
    return { enrolledCount: 0, skippedCount: 0 };
  let claimQuery = transaction
    .selectFrom("enterprise_contract_claim as claim")
    .select([
      "claim.id",
      "claim.userId",
      "claim.emailSnapshot",
      "claim.informationReleaseNoticeVersion",
      "claim.informationReleaseAcceptedAt",
    ])
    .where("claim.enterpriseContractId", "=", contract.id)
    .where("claim.revokedAt", "is", null);
  if (onlyClaimId) claimQuery = claimQuery.where("claim.id", "=", onlyClaimId);
  const claims = await claimQuery.execute();
  const coverage = await transaction
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
    .execute();
  if (claims.length === 0 || coverage.length === 0)
    return { enrolledCount: 0, skippedCount: 0 };
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
      coverage.map((item) => item.courseId),
    )
    .where("enrollment.removedAt", "is", null)
    .execute();
  const existingKeys = new Set(
    existingEnrollments.map(
      (enrollment) => `${enrollment.userId}\u0000${enrollment.courseId}`,
    ),
  );
  let enrolledCount = 0;
  let skippedCount = 0;
  for (const claim of claims)
    for (const item of coverage) {
      const enrollmentKey = `${claim.userId}\u0000${item.courseId}`;
      if (existingKeys.has(enrollmentKey)) {
        skippedCount += 1;
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
      enrolledCount += 1;
    }
  return { enrolledCount, skippedCount };
}
