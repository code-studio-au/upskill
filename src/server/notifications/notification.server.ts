import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { NOTIFICATION_DELIVERY_TOPIC } from "#/server/queue/work-message";

interface NotificationRecipientSnapshot {
  userId: string;
  name: string;
  email: string;
}

async function enqueueEmailNotification(
  transaction: Kysely<Database>,
  input: {
    templateKey:
      "account_setup_requested" | "offering_course" | "offering_event";
    recipient: NotificationRecipientSnapshot;
    emailDesignVersionId: string;
    subjectTemplateSnapshot: string;
    textBodyTemplateSnapshot: string;
    deduplicationKey: string;
    payload: unknown;
    createdAt: Date;
    availableAt?: Date;
  },
): Promise<string> {
  const notificationId = `notification_${randomUUID()}`;
  const notification = await transaction
    .insertInto("notification")
    .values({
      id: notificationId,
      channel: "email",
      templateKey: input.templateKey,
      recipientUserId: input.recipient.userId,
      recipientName: input.recipient.name,
      recipientEmail: input.recipient.email,
      emailDesignVersionId: input.emailDesignVersionId,
      subjectTemplateSnapshot: input.subjectTemplateSnapshot,
      textBodyTemplateSnapshot: input.textBodyTemplateSnapshot,
      deduplicationKey: input.deduplicationKey,
      payload: input.payload,
      lastErrorCode: null,
      deliveredAt: null,
      supersededAt: null,
      renderedSubject: null,
      renderedTextBody: null,
      renderedHtmlBody: null,
      renderedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .onConflict((conflict) => conflict.column("deduplicationKey").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!notification) {
    const existing = await transaction
      .selectFrom("notification")
      .select("id")
      .where("deduplicationKey", "=", input.deduplicationKey)
      .executeTakeFirstOrThrow();
    return existing.id;
  }
  await transaction
    .insertInto("outbox_event")
    .values({
      id: `outbox_${randomUUID()}`,
      topic: NOTIFICATION_DELIVERY_TOPIC,
      aggregateId: notification.id,
      payload: { notificationId: notification.id },
      availableAt: input.availableAt ?? input.createdAt,
      processedAt: null,
      createdAt: input.createdAt,
    })
    .execute();
  return notification.id;
}

export async function enqueueAccountSetupNotification(
  transaction: Kysely<Database>,
  input: {
    userId: string;
    name: string;
    email: string;
    deduplicationKey: string;
    setupUrl: string;
    createdAt: Date;
  },
): Promise<string> {
  const emailDesignVersion = await transaction
    .selectFrom("email_design")
    .innerJoin(
      "email_design_version",
      "email_design_version.id",
      "email_design.activeVersionId",
    )
    .select([
      "email_design_version.id",
      "email_design_version.subject",
      "email_design_version.textBody",
    ])
    .where("email_design.systemKey", "=", "account_setup_requested")
    .where("email_design.catalogue", "=", "system")
    .where("email_design_version.publishedAt", "is not", null)
    .executeTakeFirstOrThrow();
  return await enqueueEmailNotification(transaction, {
    templateKey: "account_setup_requested",
    recipient: { userId: input.userId, name: input.name, email: input.email },
    emailDesignVersionId: emailDesignVersion.id,
    subjectTemplateSnapshot: emailDesignVersion.subject,
    textBodyTemplateSnapshot: emailDesignVersion.textBody,
    deduplicationKey: input.deduplicationKey,
    payload: { version: 1, setupUrl: input.setupUrl },
    createdAt: input.createdAt,
  });
}

export async function enqueueOfferingEventNotification(
  transaction: Kysely<Database>,
  input: {
    recipient: NotificationRecipientSnapshot;
    emailDesignVersionId: string;
    subjectTemplateSnapshot: string;
    textBodyTemplateSnapshot: string;
    deduplicationKey: string;
    eventOccurrenceId: string;
    eventOccurrenceCommunicationRevisionId: string;
    audience:
      | "administrators"
      | "affected_learner"
      | "confirmed_participants"
      | "coordinators"
      | "presenters";
    trigger:
      | "event_completed"
      | "event_end"
      | "event_start"
      | "registration_selected"
      | "registration_submitted"
      | "section_release"
      | "session_start";
    eventRegistrationId?: string | null;
    eventParticipationId?: string | null;
    eventTemplateVersionSectionId?: string | null;
    variables: Readonly<Record<string, string>>;
    createdAt: Date;
    availableAt?: Date;
  },
): Promise<string> {
  return await enqueueEmailNotification(transaction, {
    templateKey: "offering_event",
    recipient: input.recipient,
    emailDesignVersionId: input.emailDesignVersionId,
    subjectTemplateSnapshot: input.subjectTemplateSnapshot,
    textBodyTemplateSnapshot: input.textBodyTemplateSnapshot,
    deduplicationKey: input.deduplicationKey,
    payload: {
      version: 1,
      kind: "offering_event",
      eventOccurrenceId: input.eventOccurrenceId,
      eventOccurrenceCommunicationRevisionId:
        input.eventOccurrenceCommunicationRevisionId,
      trigger: input.trigger,
      audience: input.audience,
      eventRegistrationId: input.eventRegistrationId ?? null,
      eventParticipationId: input.eventParticipationId ?? null,
      eventTemplateVersionSectionId:
        input.eventTemplateVersionSectionId ?? null,
      variables: input.variables,
    },
    createdAt: input.createdAt,
    ...(input.availableAt ? { availableAt: input.availableAt } : {}),
  });
}

export async function enqueueOfferingCourseNotification(
  transaction: Kysely<Database>,
  input: {
    recipient: NotificationRecipientSnapshot;
    emailDesignVersionId: string;
    subjectTemplateSnapshot: string;
    textBodyTemplateSnapshot: string;
    deduplicationKey: string;
    courseVersionId: string;
    courseVersionCommunicationId: string;
    enrollmentId: string;
    trigger:
      | "course_incomplete"
      | "enrollment_completed"
      | "enrollment_created"
      | "enrollment_expiring";
    anchorAt: Date;
    variables: Readonly<Record<string, string>>;
    createdAt: Date;
    availableAt?: Date;
  },
): Promise<string> {
  return await enqueueEmailNotification(transaction, {
    templateKey: "offering_course",
    recipient: input.recipient,
    emailDesignVersionId: input.emailDesignVersionId,
    subjectTemplateSnapshot: input.subjectTemplateSnapshot,
    textBodyTemplateSnapshot: input.textBodyTemplateSnapshot,
    deduplicationKey: input.deduplicationKey,
    payload: {
      version: 1,
      kind: "offering_course",
      courseVersionId: input.courseVersionId,
      courseVersionCommunicationId: input.courseVersionCommunicationId,
      enrollmentId: input.enrollmentId,
      trigger: input.trigger,
      anchorAt: input.anchorAt.toISOString(),
      variables: input.variables,
    },
    createdAt: input.createdAt,
    ...(input.availableAt ? { availableAt: input.availableAt } : {}),
  });
}
