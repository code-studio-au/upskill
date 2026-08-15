import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { AccessCodeRedemptionResult } from "#/features/access/access-code.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { addElapsedDays } from "#/server/time/time.server";
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

export async function redeemAccessCode(
  code: string,
  user: AuthenticatedUser,
): Promise<AccessCodeRedemptionResult> {
  const normalizedCode = normalizeAccessCode(code);
  if (!normalizedCode) return { status: "invalid" };
  const lookupId = extractAccessCodeLookupId(code);
  if (!lookupId) return { status: "invalid" };

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const grant = await transaction
        .selectFrom("access_grant")
        .select([
          "id",
          "courseVersionId",
          "quantity",
          "redeemed",
          "expiresAt",
          "revokedAt",
          "enrollmentDurationDays",
          "accessCodeLookupId",
          "encryptedAccessCode",
        ])
        .where("accessCodeLookupId", "=", lookupId)
        .forUpdate()
        .executeTakeFirst();

      if (!grant) return { status: "invalid" };
      if (
        !grant.accessCodeLookupId ||
        !grant.encryptedAccessCode ||
        !encryptedAccessCodeMatches({
          accessGrantId: grant.id,
          lookupId: grant.accessCodeLookupId,
          encryptedAccessCode: grant.encryptedAccessCode,
          submittedAccessCode: normalizedCode,
        })
      )
        return { status: "invalid" };

      const course = await transaction
        .selectFrom("course_version")
        .innerJoin("course", "course.id", "course_version.courseId")
        .select(["course.title", "course.status", "course_version.publishedAt"])
        .where("course_version.id", "=", grant.courseVersionId)
        .executeTakeFirst();
      if (
        !course ||
        course.status !== "published" ||
        course.publishedAt === null
      ) {
        return { status: "invalid" };
      }

      const restrictions = await transaction
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
        ) {
          return { status: "invalid" };
        }
      }

      const existing = await transaction
        .selectFrom("enrollment")
        .select("id")
        .where("userId", "=", user.id)
        .where("courseVersionId", "=", grant.courseVersionId)
        .executeTakeFirst();
      if (existing) {
        return { status: "already-enrolled", courseTitle: course.title };
      }
      if (
        grant.revokedAt ||
        grant.redeemed >= grant.quantity ||
        (grant.expiresAt && grant.expiresAt <= now)
      ) {
        return { status: "invalid" };
      }

      const enrollmentId = randomUUID();
      await transaction
        .insertInto("enrollment")
        .values({
          id: enrollmentId,
          userId: user.id,
          courseVersionId: grant.courseVersionId,
          accessGrantId: grant.id,
          status: "active",
          enrolledAt: now,
          completedAt: null,
          expiresAt: addElapsedDays(now, grant.enrollmentDurationDays),
          removedAt: null,
        })
        .execute();
      await transaction
        .updateTable("access_grant")
        .set((expression) => ({
          redeemed: expression("redeemed", "+", 1),
        }))
        .where("id", "=", grant.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "enrollment.access_code_redeemed",
        subjectType: "enrollment",
        subjectId: enrollmentId,
        metadata: {
          accessGrantId: grant.id,
          courseVersionId: grant.courseVersionId,
        },
        createdAt: now,
      });
      await transaction
        .insertInto("outbox_event")
        .values({
          id: randomUUID(),
          topic: "enrollment.created",
          aggregateId: enrollmentId,
          payload: {
            enrollmentId,
            userId: user.id,
            courseVersionId: grant.courseVersionId,
            source: "access-code",
          },
          availableAt: now,
          processedAt: null,
          createdAt: now,
        })
        .execute();

      return { status: "enrolled", courseTitle: course.title };
    });
}
