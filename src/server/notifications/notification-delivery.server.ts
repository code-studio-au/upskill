import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";
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
    "affected_learner",
    "confirmed_participants",
    "coordinators",
    "presenters",
  ]),
  trigger: z.enum([
    "event_completed",
    "event_end",
    "event_start",
    "registration_selected",
    "registration_submitted",
    "section_release",
    "session_start",
  ]),
  eventRegistrationId: z.string().min(1).max(200).nullable(),
  eventParticipationId: z.string().min(1).max(200).nullable(),
  eventTemplateVersionSectionId: z.string().min(1).max(200).nullable(),
  variables: z.record(z.string(), z.string()),
});

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
  payload: z.infer<typeof offeringEventPayloadSchema>,
  recipientUserId: string,
): Promise<boolean> {
  const database = getDatabase();
  const occurrence = await database
    .selectFrom("event_occurrence")
    .select("status")
    .where("id", "=", payload.eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence || ["cancelled", "archived"].includes(occurrence.status))
    return false;
  if (payload.trigger === "event_completed") {
    if (!payload.eventParticipationId) return false;
    const participation = await database
      .selectFrom("event_participation")
      .select("completedAt")
      .where("id", "=", payload.eventParticipationId)
      .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
      .executeTakeFirst();
    return participation?.completedAt !== null && Boolean(participation);
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
  if (payload.trigger === "registration_selected") {
    if (!payload.eventRegistrationId) return false;
    return Boolean(
      await database
        .selectFrom("event_registration")
        .select("id")
        .where("id", "=", payload.eventRegistrationId)
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("status", "=", "selected")
        .executeTakeFirst(),
    );
  }
  if (
    ["event_start", "event_end", "session_start"].includes(payload.trigger) &&
    payload.eventRegistrationId
  )
    return Boolean(
      await database
        .selectFrom("event_registration")
        .select("id")
        .where("id", "=", payload.eventRegistrationId)
        .where("eventOccurrenceId", "=", payload.eventOccurrenceId)
        .where("status", "=", "selected")
        .executeTakeFirst(),
    );
  if (["event_start", "event_end", "session_start"].includes(payload.trigger)) {
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
    if (payload.audience === "coordinators")
      return Boolean(
        await database
          .selectFrom("event_coordinator_assignment as assignment")
          .innerJoin(
            "event_occurrence_region as occurrenceRegion",
            "occurrenceRegion.id",
            "assignment.eventOccurrenceRegionId",
          )
          .select("assignment.id")
          .where(
            "occurrenceRegion.eventOccurrenceId",
            "=",
            payload.eventOccurrenceId,
          )
          .where("assignment.userId", "=", recipientUserId)
          .where("assignment.endedAt", "is", null)
          .where("occurrenceRegion.retiredAt", "is", null)
          .executeTakeFirst(),
      );
  }
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
      variables = {
        "user.fullName": notification.recipientName,
        "account.setupUrl": payload.setupUrl,
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
