import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { addElapsedDays } from "#/server/time/time.server";

export type CourseEntitlementOrigin =
  | {
      type: "access_grant";
      accessGrantId: string;
      accessGrantCodeId?: string;
    }
  | { type: "order"; orderId: string }
  | { type: "administrator" }
  | {
      type: "enterprise_contract";
      enterpriseContractId: string;
      enterpriseContractClaimId: string;
      enterpriseContractCoverageId: string;
    };

export async function issueCourseEntitlement(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    userEmail: string;
    courseVersionId: string;
    enrollmentDurationDays: number | null;
    enrollmentAccessGrantId: string | null;
    origin: CourseEntitlementOrigin;
    informationRelease?: { noticeVersion: string; acceptedAt: Date };
    createdAt: Date;
    eventSource:
      | "access-code"
      | "stripe-checkout"
      | "administrator"
      | "enterprise-contract";
  },
): Promise<{ enrollmentId: string; entitlementId: string }> {
  const enrollmentId = `enrollment_${randomUUID()}`;
  const entitlementId = `entitlement_${randomUUID()}`;
  await transaction
    .insertInto("enrollment")
    .values({
      id: enrollmentId,
      userId: input.userId,
      courseVersionId: input.courseVersionId,
      accessGrantId: input.enrollmentAccessGrantId,
      status: "active",
      enrolledAt: input.createdAt,
      completedAt: null,
      expiresAt:
        input.enrollmentDurationDays === null
          ? null
          : addElapsedDays(input.createdAt, input.enrollmentDurationDays),
      removedAt: null,
    })
    .execute();
  await transaction
    .insertInto("entitlement")
    .values({
      id: entitlementId,
      userId: input.userId,
      courseVersionId: input.courseVersionId,
      enrollmentId,
      originType: input.origin.type,
      originAccessGrantId:
        input.origin.type === "access_grant"
          ? input.origin.accessGrantId
          : null,
      originAccessGrantCodeId:
        input.origin.type === "access_grant"
          ? (input.origin.accessGrantCodeId ?? null)
          : null,
      originOrderId:
        input.origin.type === "order" ? input.origin.orderId : null,
      originEnterpriseContractId:
        input.origin.type === "enterprise_contract"
          ? input.origin.enterpriseContractId
          : null,
      originEnterpriseContractClaimId:
        input.origin.type === "enterprise_contract"
          ? input.origin.enterpriseContractClaimId
          : null,
      originEnterpriseContractCoverageId:
        input.origin.type === "enterprise_contract"
          ? input.origin.enterpriseContractCoverageId
          : null,
      redemptionEmailSnapshot: input.userEmail.toLocaleLowerCase("en-AU"),
      informationReleaseNoticeVersion:
        input.informationRelease?.noticeVersion ?? null,
      informationReleaseAcceptedAt:
        input.informationRelease?.acceptedAt ?? null,
      grantedAt: input.createdAt,
      revokedAt: null,
    })
    .execute();
  await transaction
    .insertInto("outbox_event")
    .values({
      id: `outbox_${randomUUID()}`,
      topic: "enrollment.created",
      aggregateId: enrollmentId,
      payload: {
        enrollmentId,
        entitlementId,
        userId: input.userId,
        courseVersionId: input.courseVersionId,
        source: input.eventSource,
      },
      availableAt: input.createdAt,
      processedAt: null,
      createdAt: input.createdAt,
    })
    .execute();
  const { enqueueCourseEnrollmentCommunications } =
    await import("#/server/notifications/course-communication-execution.server");
  await enqueueCourseEnrollmentCommunications(transaction, {
    enrollmentId,
    triggerEventId: entitlementId,
    triggers: [
      "enrollment_created",
      "course_incomplete",
      "enrollment_expiring",
    ],
    createdAt: input.createdAt,
  });
  return { enrollmentId, entitlementId };
}
