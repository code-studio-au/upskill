import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";
import {
  hasIncompleteAvailableEventPostwork,
  hasIncompleteAvailableEventPrework,
} from "./event-prework.server";
import {
  getEmailProvider,
  isAmbiguousEmailDeliveryError,
} from "./email-provider.server";
import { renderEmailTemplate } from "./email-template-contracts";

export type NotificationDeliveryOutcome =
  | { status: "delivered" }
  | { status: "already-delivered" }
  | { status: "superseded" }
  | { status: "unknown" };

function safeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    [
      "EMAIL_PROVIDER_NOT_CONFIGURED",
      "EMAIL_PROVIDER_REJECTED",
      "EMAIL_PROVIDER_REQUEST_FAILED",
    ].includes(error.message)
  )
    return error.message;
  return "EMAIL_DELIVERY_FAILED";
}

const accountSetupPayloadSchema = z.object({
  version: z.literal(1),
  setupUrl: z.url(),
  purpose: z.nullable(z.literal("late_registration_invitation")).optional(),
  eventLateRegistrationInvitationId: z
    .nullable(z.string().min(1).max(200))
    .optional(),
});

const phoneVerificationTransferredPayloadSchema = z.object({
  version: z.literal(1),
  phoneLastFour: z.string().regex(/^\d{4}$/u),
  profileUrl: z.url(),
  supportEmail: z.email(),
});

const offeringEventPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("offering_event"),
  eventOccurrenceId: z.string().min(1).max(200),
  eventOccurrenceCommunicationRevisionId: z.string().min(1).max(200),
  audience: z.enum([
    "administrators",
    "active_registrants",
    "affected_learner",
    "confirmed_participants",
    "coordinators",
    "presenters",
  ]),
  trigger: z.enum([
    "event_cancelled",
    "event_completed",
    "event_end",
    "event_rescheduled",
    "event_start",
    "late_registration_invitation",
    "post_event_incomplete",
    "prework_incomplete",
    "regional_list_locked",
    "regional_review_due",
    "registration_cancelled",
    "registration_not_selected",
    "registration_selected",
    "registration_submitted",
    "registration_waitlisted",
    "section_release",
    "session_start",
  ]),
  eventRegistrationId: z.string().min(1).max(200).nullable(),
  eventParticipationId: z.string().min(1).max(200).nullable(),
  eventTemplateVersionSectionId: z.string().min(1).max(200).nullable(),
  eventRescheduleId: z.string().min(1).max(200).nullable().optional(),
  eventLateRegistrationInvitationId: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
  eventRegionReviewRoundId: z.string().min(1).max(200).nullable().optional(),
  anchorAt: z.optional(z.nullable(z.iso.datetime())),
  variables: z.record(z.string(), z.string()),
});

type OfferingEventPayload = z.infer<typeof offeringEventPayloadSchema>;

async function eventAudienceRecipientApplicable(
  database: ReturnType<typeof getDatabase>,
  payload: OfferingEventPayload,
  recipientUserId: string,
): Promise<boolean> {
  if (payload.audience === "active_registrants") {
    if (!payload.eventRegistrationId) return false;
    return Boolean(
      await database
        .selectFrom("event_registration")
        .select("id")
        .where("id", "=", payload.eventRegistrationId)
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("userId", "=", recipientUserId)
        .where("status", "not in", ["cancelled", "not_selected", "withdrawn"])
        .executeTakeFirst(),
    );
  }
  if (
    payload.audience === "affected_learner" ||
    payload.audience === "confirmed_participants"
  ) {
    if (!payload.eventRegistrationId) return false;
    return Boolean(
      await database
        .selectFrom("event_registration")
        .select("id")
        .where("id", "=", payload.eventRegistrationId)
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("userId", "=", recipientUserId)
        .where("status", "=", "selected")
        .executeTakeFirst(),
    );
  }
  if (payload.audience === "administrators")
    return Boolean(
      await database
        .selectFrom("event_admin_assignment")
        .select("id")
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("userId", "=", recipientUserId)
        .where("endedAt", "is", null)
        .executeTakeFirst(),
    );
  if (payload.audience === "presenters")
    return Boolean(
      await database
        .selectFrom("event_presenter_assignment")
        .select("id")
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("userId", "=", recipientUserId)
        .where("endedAt", "is", null)
        .executeTakeFirst(),
    );
  let coordinatorQuery = database
    .selectFrom("event_coordinator_assignment as assignment")
    .innerJoin(
      "event_occurrence_region as occurrenceRegion",
      "occurrenceRegion.id",
      "assignment.eventOccurrenceRegionId",
    )
    .select("assignment.id")
    .where("occurrenceRegion.eventOccurrenceId", "=", payload.eventOccurrenceId)
    .where("assignment.userId", "=", recipientUserId)
    .where("assignment.endedAt", "is", null)
    .where("occurrenceRegion.retiredAt", "is", null);
  if (payload.eventRegionReviewRoundId)
    coordinatorQuery = coordinatorQuery.where((expression) =>
      expression.exists(
        expression
          .selectFrom("event_region_review_round as review")
          .select("review.id")
          .where("review.id", "=", payload.eventRegionReviewRoundId ?? "")
          .whereRef(
            "review.eventOccurrenceRegionId",
            "=",
            "assignment.eventOccurrenceRegionId",
          ),
      ),
    );
  return Boolean(await coordinatorQuery.executeTakeFirst());
}

const offeringCoursePayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("offering_course"),
  courseVersionId: z.string().min(1).max(200),
  courseVersionCommunicationId: z.string().min(1).max(200),
  enrollmentId: z.string().min(1).max(200),
  trigger: z.enum([
    "course_incomplete",
    "enrollment_completed",
    "enrollment_created",
    "enrollment_expiring",
  ]),
  anchorAt: z.iso.datetime(),
  variables: z.record(z.string(), z.string()),
});

async function eventNotificationApplicable(
  payload: OfferingEventPayload,
  recipientUserId: string,
): Promise<boolean> {
  const database = getDatabase();
  const occurrence = await database
    .selectFrom("event_occurrence")
    .select(["status", "startsAt"])
    .where("id", "=", payload.eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence) return false;
  if (payload.trigger === "event_cancelled")
    return ["cancelled", "archived"].includes(occurrence.status);
  if (["cancelled", "archived"].includes(occurrence.status)) return false;
  if (payload.trigger === "event_rescheduled") {
    if (
      !payload.anchorAt ||
      !payload.eventRescheduleId ||
      occurrence.status !== "published"
    )
      return false;
    const latest = await database
      .selectFrom("event_occurrence_reschedule")
      .select(["id", "createdAt"])
      .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (
      latest?.id !== payload.eventRescheduleId ||
      latest.createdAt.toISOString() !== payload.anchorAt
    )
      return false;
    return await eventAudienceRecipientApplicable(
      database,
      payload,
      recipientUserId,
    );
  }
  if (payload.trigger === "event_completed") {
    if (!payload.eventParticipationId) return false;
    const participation = await database
      .selectFrom("event_participation")
      .select("completedAt")
      .where("id", "=", payload.eventParticipationId)
      .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
      .executeTakeFirst();
    return Boolean(
      participation?.completedAt &&
      (!payload.anchorAt ||
        participation.completedAt.toISOString() === payload.anchorAt),
    );
  }
  if (payload.trigger === "late_registration_invitation") {
    if (
      !payload.eventLateRegistrationInvitationId ||
      occurrence.status !== "published" ||
      occurrence.startsAt <= new Date()
    )
      return false;
    return Boolean(
      await database
        .selectFrom("event_late_registration_invitation")
        .select("id")
        .where("id", "=", payload.eventLateRegistrationInvitationId)
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("userId", "=", recipientUserId)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .where("expiresAt", ">", new Date())
        .executeTakeFirst(),
    );
  }
  if (
    payload.trigger === "regional_review_due" ||
    payload.trigger === "regional_list_locked"
  ) {
    if (
      !payload.eventRegionReviewRoundId ||
      !payload.anchorAt ||
      occurrence.status !== "published"
    )
      return false;
    const review = await database
      .selectFrom("event_region_review_round")
      .select(["lockedAt", "registrationClosesAt", "coordinatorLockAt"])
      .where("id", "=", payload.eventRegionReviewRoundId)
      .executeTakeFirst();
    if (!review) return false;
    if (payload.trigger === "regional_review_due") {
      if (
        review.lockedAt ||
        review.registrationClosesAt.toISOString() !== payload.anchorAt ||
        review.coordinatorLockAt <= new Date()
      )
        return false;
    } else if (
      !review.lockedAt ||
      review.lockedAt.toISOString() !== payload.anchorAt
    )
      return false;
    return await eventAudienceRecipientApplicable(
      database,
      payload,
      recipientUserId,
    );
  }
  if (payload.trigger === "section_release") {
    if (!payload.eventParticipationId || !payload.eventTemplateVersionSectionId)
      return false;
    return Boolean(
      await database
        .selectFrom("event_section_release")
        .select("releasedAt")
        .where("eventParticipationId", "=", payload.eventParticipationId)
        .where(
          "eventTemplateVersionSectionId",
          "=",
          payload.eventTemplateVersionSectionId,
        )
        .executeTakeFirst(),
    );
  }
  if (
    [
      "registration_cancelled",
      "registration_not_selected",
      "registration_selected",
      "registration_submitted",
      "registration_waitlisted",
    ].includes(payload.trigger)
  ) {
    if (!payload.eventRegistrationId) return false;
    const expectedStatus = {
      registration_cancelled: "cancelled",
      registration_not_selected: "not_selected",
      registration_selected: "selected",
      registration_waitlisted: "waitlisted",
    } as const;
    let query = database
      .selectFrom("event_registration")
      .select("id")
      .where("id", "=", payload.eventRegistrationId)
      .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
      .where("userId", "=", recipientUserId);
    query =
      payload.trigger === "registration_submitted"
        ? query.where("status", "in", ["submitted", "selected"])
        : query.where(
            "status",
            "=",
            expectedStatus[payload.trigger as keyof typeof expectedStatus],
          );
    return Boolean(await query.executeTakeFirst());
  }
  if (payload.trigger === "prework_incomplete") {
    if (!payload.eventRegistrationId || !payload.eventParticipationId)
      return false;
    return await hasIncompleteAvailableEventPrework(database, {
      eventOccurrenceId: payload.eventOccurrenceId,
      eventRegistrationId: payload.eventRegistrationId,
      eventParticipationId: payload.eventParticipationId,
      userId: recipientUserId,
      now: new Date(),
    });
  }
  if (payload.trigger === "post_event_incomplete") {
    if (!payload.eventRegistrationId || !payload.eventParticipationId)
      return false;
    return await hasIncompleteAvailableEventPostwork(database, {
      eventOccurrenceId: payload.eventOccurrenceId,
      eventRegistrationId: payload.eventRegistrationId,
      eventParticipationId: payload.eventParticipationId,
      userId: recipientUserId,
      now: new Date(),
    });
  }
  if (["event_start", "event_end", "session_start"].includes(payload.trigger))
    return await eventAudienceRecipientApplicable(
      database,
      payload,
      recipientUserId,
    );
  return true;
}

async function courseNotificationApplicable(
  payload: z.infer<typeof offeringCoursePayloadSchema>,
): Promise<boolean> {
  const enrollment = await getDatabase()
    .selectFrom("enrollment")
    .select(["status", "completedAt", "expiresAt", "removedAt"])
    .where("id", "=", payload.enrollmentId)
    .where("courseVersionId", "=", payload.courseVersionId)
    .executeTakeFirst();
  if (!enrollment || enrollment.removedAt || enrollment.status === "cancelled")
    return false;
  if (payload.trigger === "enrollment_completed")
    return enrollment.completedAt !== null;
  if (payload.trigger === "course_incomplete")
    return enrollment.status === "active" && enrollment.completedAt === null;
  if (payload.trigger === "enrollment_expiring")
    return (
      enrollment.status === "active" &&
      enrollment.expiresAt?.toISOString() === payload.anchorAt
    );
  return true;
}

export async function deliverNotification(
  notificationId: string,
): Promise<NotificationDeliveryOutcome> {
  const database = getDatabase();
  const notification = await database
    .selectFrom("notification")
    .selectAll()
    .where("id", "=", notificationId)
    .executeTakeFirstOrThrow();
  const emailDesignVersion = await database
    .selectFrom("email_design_version")
    .select(["contractKey", "contractVersion"])
    .where("id", "=", notification.emailDesignVersionId)
    .where("publishedAt", "is not", null)
    .executeTakeFirstOrThrow();
  if (notification.status === "delivered")
    return { status: "already-delivered" };
  if (notification.status === "superseded") return { status: "superseded" };
  if (notification.status === "unknown") return { status: "unknown" };

  const attempt = notification.attempts + 1;
  const claimTime = new Date();
  const staleBefore = new Date(
    claimTime.getTime() - getServerEnv().SQS_VISIBILITY_TIMEOUT_SECONDS * 1_000,
  );
  const claimed = await database
    .updateTable("notification")
    .set({ attempts: attempt, status: "processing", updatedAt: claimTime })
    .where("id", "=", notification.id)
    .where((expression) =>
      expression.or([
        expression("status", "in", ["pending", "failed"]),
        expression.and([
          expression("status", "=", "processing"),
          expression("updatedAt", "<=", staleBefore),
        ]),
      ]),
    )
    .returning("id")
    .executeTakeFirst();
  if (!claimed) {
    const current = await database
      .selectFrom("notification")
      .select("status")
      .where("id", "=", notification.id)
      .executeTakeFirstOrThrow();
    if (current.status === "delivered") return { status: "already-delivered" };
    if (current.status === "superseded") return { status: "superseded" };
    if (current.status === "unknown") return { status: "unknown" };
    throw new Error("EMAIL_DELIVERY_IN_PROGRESS");
  }

  let provider: ReturnType<typeof getEmailProvider> | undefined;
  let acceptedProviderMessageId: string | null = null;
  try {
    let variables: Readonly<Record<string, string>>;
    let retainedPayload: Record<string, unknown> = { version: 1 };
    if (notification.templateKey === "account_setup_requested") {
      const payload = accountSetupPayloadSchema.parse(notification.payload);
      if (payload.eventLateRegistrationInvitationId) {
        const applicable = await database
          .selectFrom("event_late_registration_invitation as invitation")
          .innerJoin(
            "event_occurrence as occurrence",
            "occurrence.id",
            "invitation.eventOccurrenceId",
          )
          .select("invitation.id")
          .where(
            "invitation.id",
            "=",
            payload.eventLateRegistrationInvitationId,
          )
          .where("invitation.userId", "=", notification.recipientUserId)
          .where("invitation.acceptedAt", "is", null)
          .where("invitation.revokedAt", "is", null)
          .where("invitation.expiresAt", ">", new Date())
          .where("occurrence.status", "=", "published")
          .where("occurrence.startsAt", ">", new Date())
          .executeTakeFirst();
        if (!applicable) {
          const supersededAt = new Date();
          await database
            .updateTable("notification")
            .set({
              status: "superseded",
              supersededAt,
              updatedAt: supersededAt,
            })
            .where("id", "=", notification.id)
            .where("status", "=", "processing")
            .execute();
          return { status: "superseded" };
        }
      }
      variables = {
        "user.fullName": notification.recipientName,
        "account.setupUrl": payload.setupUrl,
      };
      retainedPayload = {
        version: payload.version,
        ...(payload.purpose ? { purpose: payload.purpose } : {}),
        ...(payload.eventLateRegistrationInvitationId
          ? {
              eventLateRegistrationInvitationId:
                payload.eventLateRegistrationInvitationId,
            }
          : {}),
      };
    } else if (notification.templateKey === "phone_verification_transferred") {
      const payload = phoneVerificationTransferredPayloadSchema.parse(
        notification.payload,
      );
      variables = {
        "user.fullName": notification.recipientName,
        "phone.lastFour": payload.phoneLastFour,
        "account.profileUrl": payload.profileUrl,
        "platform.supportEmail": payload.supportEmail,
      };
    } else if (notification.templateKey === "offering_event") {
      const payload = offeringEventPayloadSchema.parse(notification.payload);
      if (
        !(await eventNotificationApplicable(
          payload,
          notification.recipientUserId,
        ))
      ) {
        const supersededAt = new Date();
        await database
          .updateTable("notification")
          .set({
            status: "superseded",
            supersededAt,
            updatedAt: supersededAt,
          })
          .where("id", "=", notification.id)
          .where("status", "=", "processing")
          .execute();
        return { status: "superseded" };
      }
      variables = payload.variables;
      retainedPayload = {
        version: payload.version,
        kind: payload.kind,
        eventOccurrenceId: payload.eventOccurrenceId,
        eventOccurrenceCommunicationRevisionId:
          payload.eventOccurrenceCommunicationRevisionId,
        trigger: payload.trigger,
        audience: payload.audience,
        eventRegistrationId: payload.eventRegistrationId,
        eventParticipationId: payload.eventParticipationId,
        eventTemplateVersionSectionId: payload.eventTemplateVersionSectionId,
        eventRescheduleId: payload.eventRescheduleId ?? null,
        eventLateRegistrationInvitationId:
          payload.eventLateRegistrationInvitationId ?? null,
        eventRegionReviewRoundId: payload.eventRegionReviewRoundId ?? null,
        anchorAt: payload.anchorAt ?? null,
      };
    } else {
      const payload = offeringCoursePayloadSchema.parse(notification.payload);
      if (!(await courseNotificationApplicable(payload))) {
        const supersededAt = new Date();
        await database
          .updateTable("notification")
          .set({
            status: "superseded",
            supersededAt,
            updatedAt: supersededAt,
          })
          .where("id", "=", notification.id)
          .where("status", "=", "processing")
          .execute();
        return { status: "superseded" };
      }
      variables = payload.variables;
      retainedPayload = {
        version: payload.version,
        kind: payload.kind,
        courseVersionId: payload.courseVersionId,
        courseVersionCommunicationId: payload.courseVersionCommunicationId,
        enrollmentId: payload.enrollmentId,
        trigger: payload.trigger,
        anchorAt: payload.anchorAt,
      };
    }
    const activeProvider = getEmailProvider(database);
    provider = activeProvider;
    const rendered = renderEmailTemplate({
      contractKey: emailDesignVersion.contractKey,
      contractVersion: emailDesignVersion.contractVersion,
      subject: notification.subjectTemplateSnapshot,
      textBody: notification.textBodyTemplateSnapshot,
      variables,
    });
    const renderedAt = new Date();
    await database
      .updateTable("notification")
      .set({
        renderedSubject: rendered.subject,
        renderedTextBody: rendered.textBody,
        renderedHtmlBody: rendered.htmlBody,
        renderedAt,
        updatedAt: renderedAt,
      })
      .where("id", "=", notification.id)
      .where("status", "=", "processing")
      .executeTakeFirstOrThrow();
    const delivery = await activeProvider.send({
      notificationId: notification.id,
      recipientEmail: notification.recipientEmail,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
    });
    acceptedProviderMessageId = delivery.messageId;
    const deliveredAt = new Date();
    const recorded = await database
      .transaction()
      .execute(async (transaction) => {
        await transaction
          .insertInto("notification_delivery_attempt")
          .values({
            id: `notification_delivery_${randomUUID()}`,
            notificationId: notification.id,
            attempt,
            provider: activeProvider.id,
            status: "delivered",
            providerMessageId: delivery.messageId,
            errorCode: null,
            createdAt: deliveredAt,
          })
          .onConflict((conflict) =>
            conflict.columns(["notificationId", "attempt"]).doNothing(),
          )
          .execute();
        return await transaction
          .updateTable("notification")
          .set({
            status: "delivered",
            payload: retainedPayload,
            deliveredAt,
            lastErrorCode: null,
            supersededAt: null,
            updatedAt: deliveredAt,
          })
          .where("id", "=", notification.id)
          .where("status", "=", "processing")
          .returning("id")
          .executeTakeFirst();
      });
    return recorded ? { status: "delivered" } : { status: "superseded" };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const failedAt = new Date();
    const ambiguous =
      acceptedProviderMessageId !== null ||
      isAmbiguousEmailDeliveryError(error);
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("notification_delivery_attempt")
        .values({
          id: `notification_delivery_${randomUUID()}`,
          notificationId: notification.id,
          attempt,
          provider: provider?.id ?? "unconfigured",
          status: ambiguous ? "unknown" : "failed",
          providerMessageId: acceptedProviderMessageId,
          errorCode,
          createdAt: failedAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["notificationId", "attempt"]).doNothing(),
        )
        .execute();
      await transaction
        .updateTable("notification")
        .set({
          status: ambiguous ? "unknown" : "failed",
          lastErrorCode: errorCode,
          updatedAt: failedAt,
        })
        .where("id", "=", notification.id)
        .where("status", "=", "processing")
        .execute();
    });
    if (ambiguous) return { status: "unknown" };
    throw error;
  }
}
