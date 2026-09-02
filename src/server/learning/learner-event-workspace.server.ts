import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { LearnerEventWorkspaceResult } from "#/features/learner/learner-event-workspace.schema";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";
import {
  calculateEventSectionReleaseAt,
  ensureEventSectionReleased,
} from "#/server/learning/event-section-release.server";
import { findEventRegistrationQuestionnaire } from "#/server/registration/learner-registration-questionnaire.server";

export async function findLearnerEventWorkspace(
  eventOccurrenceId: string,
  user: AuthenticatedUser,
): Promise<
  Exclude<LearnerEventWorkspaceResult, { status: "unauthenticated" }>
> {
  const database = getDatabase();
  const questionnaire = await findEventRegistrationQuestionnaire(
    eventOccurrenceId,
    user,
  );
  if (
    questionnaire &&
    typeof questionnaire === "object" &&
    !questionnaire.submittedAt
  )
    return { status: "registration-required", questionnaire };
  if (questionnaire === null || questionnaire === "unavailable")
    return { status: "not-found" };
  const participation = await database
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .innerJoin(
      "event_template as template",
      "template.id",
      "version.eventTemplateId",
    )
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .select([
      "participation.id as participationId",
      "participation.mode",
      "participation.createdAt as participationCreatedAt",
      "participation.completedAt",
      "registration.status as registrationStatus",
      "occurrence.id as eventOccurrenceId",
      "occurrence.status",
      "occurrence.title",
      "occurrence.timezone",
      "occurrence.deliveryMode",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.venueName",
      "occurrence.venueAddress",
      "occurrence.eventTemplateVersionId",
      "template.title as eventTemplateTitle",
      "version.summary",
      "version.description",
      "version.hasCompletionCertificate",
    ])
    .where("occurrence.id", "=", eventOccurrenceId)
    .where("participation.userId", "=", user.id)
    .executeTakeFirst();
  if (!participation) return { status: "not-found" };
  if (
    participation.status === "cancelled" ||
    participation.registrationStatus === "cancelled"
  )
    return { status: "cancelled", title: participation.title };
  if (
    participation.mode === "registered" &&
    participation.registrationStatus !== "selected"
  )
    return { status: "not-found" };
  const [sections, items, sessions, attendance, progress] = await Promise.all([
    database
      .selectFrom("event_template_version_section")
      .select([
        "id",
        "position",
        "title",
        "description",
        "phase",
        "releaseAnchor",
        "releaseOffsetAmount",
        "releaseOffsetUnit",
      ])
      .where(
        "eventTemplateVersionId",
        "=",
        participation.eventTemplateVersionId,
      )
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_template_version_item")
      .select([
        "id",
        "sectionId",
        "position",
        "kind",
        "title",
        "required",
        "durationMinutes",
        "learningActivityVersionId",
        "sessionDefinitionId",
      ])
      .where(
        "eventTemplateVersionId",
        "=",
        participation.eventTemplateVersionId,
      )
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_session")
      .select([
        "id",
        "sessionDefinitionId",
        "startsAt",
        "endsAt",
        "venueName",
        "venueAddress",
        "virtualJoinUrl",
      ])
      .where("eventOccurrenceId", "=", participation.eventOccurrenceId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_attendance")
      .select(["eventSessionId", "state"])
      .where("eventParticipationId", "=", participation.participationId)
      .execute(),
    database
      .selectFrom("learning_item_progress")
      .select("eventTemplateVersionItemId")
      .where("eventParticipationId", "=", participation.participationId)
      .where("state", "=", "completed")
      .execute(),
  ]);
  const finalSessionEndsAt = sessions.at(-1)?.endsAt ?? participation.endsAt;
  const now = new Date();
  const completedItemIds = new Set(
    progress.flatMap((row) =>
      row.eventTemplateVersionItemId ? [row.eventTemplateVersionItemId] : [],
    ),
  );
  const attendanceBySession = new Map(
    attendance.map((row) => [row.eventSessionId, row.state]),
  );
  const sessionByDefinition = new Map(
    sessions.map((session) => [session.sessionDefinitionId, session]),
  );
  const workspaceSections = await Promise.all(
    sections.map(async (section) => {
      const releaseAt = calculateEventSectionReleaseAt({
        releaseAnchor: section.releaseAnchor,
        releaseOffsetAmount: section.releaseOffsetAmount,
        releaseOffsetUnit: section.releaseOffsetUnit,
        timezone: participation.timezone,
        participationCreatedAt: participation.participationCreatedAt,
        occurrenceStartsAt: participation.startsAt,
        occurrenceEndsAt: participation.endsAt,
        finalSessionEndsAt,
      });
      const available = await ensureEventSectionReleased(database, {
        eventParticipationId: participation.participationId,
        eventTemplateVersionSectionId: section.id,
        calculatedReleaseAt: releaseAt,
        now,
      });
      const sectionItems = items
        .filter((item) => item.sectionId === section.id)
        .map((item) => {
          const session = item.sessionDefinitionId
            ? (sessionByDefinition.get(item.sessionDefinitionId) ?? null)
            : null;
          const attendanceState = session
            ? (attendanceBySession.get(session.id) ?? "not_recorded")
            : "not_recorded";
          const completed = session
            ? attendanceState === "attended"
            : completedItemIds.has(item.id);
          const sessionAvailable = Boolean(
            available && session && session.startsAt <= now,
          );
          return {
            id: item.id,
            position: item.position,
            kind: item.kind,
            title: item.title,
            required: item.required,
            durationMinutes: item.durationMinutes,
            completionState: completed
              ? ("completed" as const)
              : ("incomplete" as const),
            session: session
              ? {
                  id: session.id,
                  startsAt: session.startsAt.toISOString(),
                  endsAt: session.endsAt.toISOString(),
                  venueName: session.venueName,
                  venueAddress: session.venueAddress,
                  virtualJoinUrl: sessionAvailable
                    ? session.virtualJoinUrl
                    : null,
                  attendanceState,
                }
              : null,
            learningActivityVersionId: item.learningActivityVersionId,
          };
        });
      const required = sectionItems.filter((item) => item.required);
      const targets = required.length > 0 ? required : sectionItems;
      const complete =
        targets.length > 0 &&
        targets.every((item) => item.completionState === "completed");
      return {
        id: section.id,
        position: section.position,
        title: section.title,
        description: section.description,
        phase: section.phase,
        available,
        releaseAt: releaseAt.toISOString(),
        completedItems: sectionItems.filter(
          (item) => item.completionState === "completed",
        ).length,
        totalItems: sectionItems.length,
        completionState: available
          ? complete
            ? ("completed" as const)
            : ("incomplete" as const)
          : ("locked" as const),
        items: sectionItems,
      };
    }),
  );
  const completed =
    workspaceSections.length > 0 &&
    workspaceSections.every(
      (section) => section.completionState === "completed",
    );
  let completedAt = participation.completedAt;
  if (completed && !completedAt) {
    completedAt = now;
    await database.transaction().execute(async (transaction) => {
      await completeEventParticipationIfReady(
        transaction,
        {
          eventParticipationId: participation.participationId,
          source: "workspace",
        },
        now,
      );
    });
  }

  return {
    status: "ready",
    workspace: {
      eventOccurrenceId: participation.eventOccurrenceId,
      eventParticipationId: participation.participationId,
      title: participation.title,
      eventTemplateTitle: participation.eventTemplateTitle,
      summary: participation.summary,
      description: participation.description,
      timezone: participation.timezone,
      deliveryMode: participation.deliveryMode,
      startsAt: participation.startsAt.toISOString(),
      endsAt: participation.endsAt.toISOString(),
      venueName: participation.venueName,
      venueAddress: participation.venueAddress,
      completionState: completed ? "completed" : "incomplete",
      completedAt: completedAt?.toISOString() ?? null,
      certificateAvailable: completed && participation.hasCompletionCertificate,
      sections: workspaceSections,
    },
  };
}
