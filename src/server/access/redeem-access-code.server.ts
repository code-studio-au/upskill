import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type {
  AccessCodePreviewResult,
  AccessCodeRedemptionResult,
} from "#/features/access/access-code.schema";
import { INFORMATION_RELEASE_NOTICE_VERSION } from "#/features/access/access-code.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";
import { issueConfirmedEventRegistration } from "#/server/events/confirmed-event-registration.server";
import {
  claimEnterpriseContractAccess,
  previewEnterpriseContractCode,
} from "#/server/enterprise/enterprise-contract-access.server";
import { encryptedAccessCodeMatches } from "./access-code-encryption.server";
import {
  extractAccessCodeLookupId,
  normalizeAccessCode,
} from "./access-code.server";

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

type EligibleGrantBase = {
  id: string;
  accessGrantCodeId: string | null;
  offeringTitle: string;
  organizationName: string;
  kind: "bulk_purchase" | "enterprise_contract";
};
type EligibleGrant =
  | (EligibleGrantBase & {
      offeringType: "course";
      courseVersionId: string;
      enrollmentDurationDays: number;
    })
  | (EligibleGrantBase & {
      offeringType: "event";
      eventOccurrenceId: string;
    });

async function resolveEligibleGrant(
  database: Kysely<Database>,
  code: string,
  user: AuthenticatedUser,
  lock: boolean,
): Promise<
  | { status: "ready"; grant: EligibleGrant }
  | {
      status: "already-enrolled";
      offeringTitle: string;
      offeringType: "course" | "event";
    }
  | { status: "invalid" }
> {
  const normalizedCode = normalizeAccessCode(code);
  const lookupId = extractAccessCodeLookupId(code);
  if (!normalizedCode || !lookupId) return { status: "invalid" };
  let query = database
    .selectFrom("access_grant_code")
    .innerJoin(
      "access_grant",
      "access_grant.id",
      "access_grant_code.accessGrantId",
    )
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
    .leftJoin("organization", "organization.id", "access_grant.organizationId")
    .select([
      "access_grant.id",
      "access_grant.courseVersionId",
      "access_grant.eventOccurrenceId",
      "access_grant.quantity",
      "access_grant.redeemed",
      "access_grant.expiresAt",
      "access_grant.revokedAt",
      "access_grant.enrollmentDurationDays",
      "access_grant.fulfillmentMode",
      "access_grant_code.id as accessGrantCodeId",
      "access_grant_code.lookupId",
      "access_grant_code.encryptedAccessCode",
      "access_grant.kind",
      "course.title as courseTitle",
      "course.status as courseStatus",
      "course_version.publishedAt",
      "event_occurrence.title as eventTitle",
      "event_occurrence.status as eventStatus",
      "event_occurrence.startsAt as eventStartsAt",
      "organization.name as organizationName",
    ])
    .where("access_grant_code.lookupId", "=", lookupId);
  if (lock) query = query.forUpdate(["access_grant", "access_grant_code"]);
  const grant = await query.executeTakeFirst();
  if (
    !grant ||
    !encryptedAccessCodeMatches({
      accessGrantId: grant.id,
      lookupId: grant.lookupId,
      encryptedAccessCode: grant.encryptedAccessCode,
      submittedAccessCode: normalizedCode,
    }) ||
    grant.kind === "individual_purchase"
  )
    return { status: "invalid" };

  if (grant.fulfillmentMode === "single_use_codes") {
    const courseRedemption = await database
      .selectFrom("entitlement")
      .select("id")
      .where("originAccessGrantCodeId", "=", grant.accessGrantCodeId)
      .executeTakeFirst();
    const eventRedemption = await database
      .selectFrom("event_access_redemption")
      .select("id")
      .where("accessGrantCodeId", "=", grant.accessGrantCodeId)
      .executeTakeFirst();
    if (courseRedemption || eventRedemption) return { status: "invalid" };
  }

  const restrictions = await database
    .selectFrom("access_grant_domain")
    .select("domain")
    .where("accessGrantId", "=", grant.id)
    .execute();
  if (restrictions.length > 0) {
    const domain = emailDomain(user.email);
    if (
      !user.emailVerified ||
      !domain ||
      !restrictions.some((restriction) => restriction.domain === domain)
    )
      return { status: "invalid" };
  }
  const now = new Date();
  if (grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now))
    return { status: "invalid" };
  const common = {
    id: grant.id,
    accessGrantCodeId:
      grant.fulfillmentMode === "single_use_codes"
        ? grant.accessGrantCodeId
        : null,
    organizationName: grant.organizationName ?? "Access provider",
    kind: grant.kind,
  };
  if (
    grant.courseVersionId &&
    grant.courseTitle &&
    grant.enrollmentDurationDays &&
    grant.courseStatus === "published" &&
    grant.publishedAt
  ) {
    const existing = await database
      .selectFrom("enrollment")
      .select("id")
      .where("userId", "=", user.id)
      .where("courseVersionId", "=", grant.courseVersionId)
      .executeTakeFirst();
    if (existing)
      return {
        status: "already-enrolled",
        offeringTitle: grant.courseTitle,
        offeringType: "course",
      };
    if (grant.redeemed >= grant.quantity) return { status: "invalid" };
    return {
      status: "ready",
      grant: {
        ...common,
        offeringType: "course",
        offeringTitle: grant.courseTitle,
        courseVersionId: grant.courseVersionId,
        enrollmentDurationDays: grant.enrollmentDurationDays,
      },
    };
  }
  if (
    grant.eventOccurrenceId &&
    grant.eventTitle &&
    grant.eventStatus === "published" &&
    grant.eventStartsAt &&
    grant.eventStartsAt > now
  ) {
    const existing = await database
      .selectFrom("event_registration")
      .select("id")
      .where("userId", "=", user.id)
      .where("eventOccurrenceId", "=", grant.eventOccurrenceId)
      .executeTakeFirst();
    if (existing)
      return {
        status: "already-enrolled",
        offeringTitle: grant.eventTitle,
        offeringType: "event",
      };
    if (grant.redeemed >= grant.quantity) return { status: "invalid" };
    return {
      status: "ready",
      grant: {
        ...common,
        offeringType: "event",
        offeringTitle: grant.eventTitle,
        eventOccurrenceId: grant.eventOccurrenceId,
      },
    };
  }
  return { status: "invalid" };
}

export async function previewAccessCode(
  code: string,
  user: AuthenticatedUser,
): Promise<AccessCodePreviewResult> {
  const database = getDatabase();
  const resolved = await resolveEligibleGrant(database, code, user, false);
  if (resolved.status === "invalid")
    return (
      (await previewEnterpriseContractCode(database, code, user)) ?? resolved
    );
  if (resolved.status !== "ready") return resolved;
  return {
    status: "ready",
    offeringTitle: resolved.grant.offeringTitle,
    offeringType: resolved.grant.offeringType,
    organizationName: resolved.grant.organizationName,
    accessKind: resolved.grant.kind,
    noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
  };
}

export async function redeemAccessCode(
  input: {
    code: string;
    informationReleaseAccepted: true;
    noticeVersion: typeof INFORMATION_RELEASE_NOTICE_VERSION;
  },
  user: AuthenticatedUser,
): Promise<AccessCodeRedemptionResult> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const resolved = await resolveEligibleGrant(
        transaction,
        input.code,
        user,
        true,
      );
      if (resolved.status === "invalid")
        return (
          (await claimEnterpriseContractAccess(
            transaction,
            { code: input.code, noticeVersion: input.noticeVersion },
            user,
          )) ?? resolved
        );
      if (resolved.status !== "ready") return resolved;
      const now = new Date();
      if (resolved.grant.offeringType === "event") {
        const registration = await issueConfirmedEventRegistration(
          transaction,
          {
            eventOccurrenceId: resolved.grant.eventOccurrenceId,
            user,
            source: "access_code",
            eligibilitySource: "access_code",
            createdAt: now,
          },
        );
        if (registration.status !== "created")
          return { status: "invalid" } as const;
        const redemptionId = `event_access_redemption_${randomUUID()}`;
        await transaction
          .insertInto("event_access_redemption")
          .values({
            id: redemptionId,
            accessGrantId: resolved.grant.id,
            accessGrantCodeId: resolved.grant.accessGrantCodeId,
            eventRegistrationId: registration.eventRegistrationId,
            eventParticipationId: registration.eventParticipationId,
            userId: user.id,
            redemptionEmailSnapshot: user.email,
            informationReleaseNoticeVersion: input.noticeVersion,
            informationReleaseAcceptedAt: now,
            redeemedAt: now,
          })
          .execute();
        await transaction
          .updateTable("access_grant")
          .set((expression) => ({ redeemed: expression("redeemed", "+", 1) }))
          .where("id", "=", resolved.grant.id)
          .executeTakeFirstOrThrow();
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "entitlement.information_release_accepted",
          subjectType: "event_access_redemption",
          subjectId: redemptionId,
          aggregateId: registration.eventRegistrationId,
          metadata: {
            accessGrantId: resolved.grant.id,
            accessGrantCodeId: resolved.grant.accessGrantCodeId,
            eventOccurrenceId: resolved.grant.eventOccurrenceId,
            noticeVersion: input.noticeVersion,
          },
          createdAt: now,
        });
        return {
          status: "enrolled",
          offeringTitle: resolved.grant.offeringTitle,
          offeringType: "event",
        };
      }
      const { enrollmentId, entitlementId } = await issueCourseEntitlement(
        transaction,
        {
          userId: user.id,
          userEmail: user.email,
          courseVersionId: resolved.grant.courseVersionId,
          enrollmentDurationDays: resolved.grant.enrollmentDurationDays,
          enrollmentAccessGrantId: resolved.grant.id,
          origin: resolved.grant.accessGrantCodeId
            ? {
                type: "access_grant",
                accessGrantId: resolved.grant.id,
                accessGrantCodeId: resolved.grant.accessGrantCodeId,
              }
            : {
                type: "access_grant",
                accessGrantId: resolved.grant.id,
              },
          informationRelease: {
            noticeVersion: input.noticeVersion,
            acceptedAt: now,
          },
          createdAt: now,
          eventSource: "access-code",
        },
      );
      await transaction
        .updateTable("access_grant")
        .set((expression) => ({ redeemed: expression("redeemed", "+", 1) }))
        .where("id", "=", resolved.grant.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "entitlement.information_release_accepted",
        subjectType: "entitlement",
        subjectId: entitlementId,
        aggregateId: enrollmentId,
        metadata: {
          accessGrantId: resolved.grant.id,
          accessGrantCodeId: resolved.grant.accessGrantCodeId,
          noticeVersion: input.noticeVersion,
        },
        createdAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "enrollment.access_code_redeemed",
        subjectType: "enrollment",
        subjectId: enrollmentId,
        metadata: {
          accessGrantId: resolved.grant.id,
          accessGrantCodeId: resolved.grant.accessGrantCodeId,
          courseVersionId: resolved.grant.courseVersionId,
          entitlementId,
        },
        createdAt: now,
      });
      return {
        status: "enrolled",
        offeringTitle: resolved.grant.offeringTitle,
        offeringType: "course",
      };
    });
}
