import "@tanstack/react-start/server-only";

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

type EligibleGrant = {
  id: string;
  accessGrantCodeId: string | null;
  courseVersionId: string;
  courseTitle: string;
  organizationName: string;
  kind: "bulk_purchase" | "enterprise_contract";
  enrollmentDurationDays: number;
};

async function resolveEligibleGrant(
  database: Kysely<Database>,
  code: string,
  user: AuthenticatedUser,
  lock: boolean,
): Promise<
  | { status: "ready"; grant: EligibleGrant }
  | { status: "already-enrolled"; courseTitle: string }
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
    .innerJoin(
      "course_version",
      "course_version.id",
      "access_grant.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .leftJoin("organization", "organization.id", "access_grant.organizationId")
    .select([
      "access_grant.id",
      "access_grant.courseVersionId",
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
    grant.courseStatus !== "published" ||
    grant.publishedAt === null ||
    grant.kind === "individual_purchase"
  )
    return { status: "invalid" };

  if (grant.fulfillmentMode === "single_use_codes") {
    const redemption = await database
      .selectFrom("entitlement")
      .select("id")
      .where("originAccessGrantCodeId", "=", grant.accessGrantCodeId)
      .executeTakeFirst();
    if (redemption) return { status: "invalid" };
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
  const existing = await database
    .selectFrom("enrollment")
    .select("id")
    .where("userId", "=", user.id)
    .where("courseVersionId", "=", grant.courseVersionId)
    .executeTakeFirst();
  if (existing)
    return { status: "already-enrolled", courseTitle: grant.courseTitle };
  const now = new Date();
  if (
    grant.revokedAt ||
    grant.redeemed >= grant.quantity ||
    (grant.expiresAt && grant.expiresAt <= now)
  )
    return { status: "invalid" };
  return {
    status: "ready",
    grant: {
      id: grant.id,
      accessGrantCodeId:
        grant.fulfillmentMode === "single_use_codes"
          ? grant.accessGrantCodeId
          : null,
      courseVersionId: grant.courseVersionId,
      courseTitle: grant.courseTitle,
      organizationName: grant.organizationName ?? "Access provider",
      kind: grant.kind,
      enrollmentDurationDays: grant.enrollmentDurationDays,
    },
  };
}

export async function previewAccessCode(
  code: string,
  user: AuthenticatedUser,
): Promise<AccessCodePreviewResult> {
  const database = getDatabase();
  const resolved = await resolveEligibleGrant(database, code, user, false);
  if (resolved.status !== "ready") return resolved;
  return {
    status: "ready",
    courseTitle: resolved.grant.courseTitle,
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
      if (resolved.status !== "ready") return resolved;
      const now = new Date();
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
      return { status: "enrolled", courseTitle: resolved.grant.courseTitle };
    });
}
