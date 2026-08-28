import "@tanstack/react-start/server-only";

import type {
  AdminLearnerEvent,
  AdminLearnerEventDetail,
  AdminLearnerEventHistoryItem,
} from "#/features/admin/admin.schema";
import { sql } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import { findEventParticipantProgress } from "#/server/events/event-operations.server";

interface EventOccurrenceProjection {
  eventOccurrenceId: string;
  title: string;
  slug: string;
  status: AdminLearnerEvent["occurrence"]["status"];
  deliveryMode: AdminLearnerEvent["occurrence"]["deliveryMode"];
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  eventTemplateVersionId: string;
  eventTemplateTitle: string;
  eventTemplateVersion: number;
  hasCompletionCertificate: boolean;
}

function learnerPredicate() {
  return sql<boolean>`not exists (
      select 1 from platform_admin
      where platform_admin."userId" = "user".id
    ) and not exists (
      select 1 from platform_admin_invitation invitation
      where invitation."userId" = "user".id
        and invitation."acceptedAt" is null
        and invitation."cancelledAt" is null
    )`;
}

function projectOccurrence(
  row: EventOccurrenceProjection,
): AdminLearnerEvent["occurrence"] {
  return {
    id: row.eventOccurrenceId,
    title: row.title,
    slug: row.slug,
    status: row.status,
    deliveryMode: row.deliveryMode,
    timezone: row.timezone,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    eventTemplateTitle: row.eventTemplateTitle,
    eventTemplateVersion: row.eventTemplateVersion,
  };
}

function attendanceMetadata(value: unknown): {
  state: "not_recorded" | "checked_in" | "attended" | "absent";
  source:
    "system" | "self_check_in" | "coordinator" | "presenter" | "administrator";
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const states = ["not_recorded", "checked_in", "attended", "absent"];
  const sources = [
    "system",
    "self_check_in",
    "coordinator",
    "presenter",
    "administrator",
  ];
  if (
    typeof metadata.state !== "string" ||
    !states.includes(metadata.state) ||
    typeof metadata.source !== "string" ||
    !sources.includes(metadata.source)
  )
    return null;
  return {
    state: metadata.state as
      "not_recorded" | "checked_in" | "attended" | "absent",
    source: metadata.source as
      | "system"
      | "self_check_in"
      | "coordinator"
      | "presenter"
      | "administrator",
  };
}

async function findAdminLearnerEventRecords(
  userId: string,
  options: {
    eventOccurrenceId?: string;
    includeDetails: boolean;
  },
): Promise<Array<AdminLearnerEvent>> {
  const database = getDatabase();
  const { eventOccurrenceId, includeDetails } = options;
  const [registrations, participations] = await Promise.all([
    database
      .selectFrom("event_registration as registration")
      .innerJoin(
        "event_occurrence as occurrence",
        "occurrence.id",
        "registration.eventOccurrenceId",
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
        "event_occurrence_region as occurrenceRegion",
        "occurrenceRegion.id",
        "registration.eventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as registrationRegion",
        "registrationRegion.id",
        "occurrenceRegion.regionId",
      )
      .leftJoin(
        "event_registration_region_decision as regionDecision",
        (join) =>
          join
            .onRef("regionDecision.eventRegistrationId", "=", "registration.id")
            .on("regionDecision.supersededAt", "is", null),
      )
      .select([
        "registration.id as registrationId",
        "registration.status as registrationStatus",
        "registration.source as registrationSource",
        "registration.eligibilitySource",
        "registration.nameSnapshot as registrationNameSnapshot",
        "registration.emailSnapshot as registrationEmailSnapshot",
        "registration.submittedAt",
        "registration.coordinatorDecidedAt",
        "registration.finalDecidedAt",
        "registration.lockedInAt",
        "registrationRegion.code as registrationRegionCode",
        "registrationRegion.name as registrationRegionName",
        "regionDecision.reportingRegionCodeSnapshot",
        "regionDecision.reportingRegionNameSnapshot",
        "regionDecision.reportingRegionGroupCodeSnapshot",
        "regionDecision.reportingRegionGroupNameSnapshot",
        "occurrence.id as eventOccurrenceId",
        "occurrence.title",
        "occurrence.slug",
        "occurrence.status",
        "occurrence.deliveryMode",
        "occurrence.timezone",
        "occurrence.startsAt",
        "occurrence.endsAt",
        "occurrence.eventTemplateVersionId",
        "template.title as eventTemplateTitle",
        "version.version as eventTemplateVersion",
        "version.hasCompletionCertificate",
      ])
      .where("registration.userId", "=", userId)
      .$if(eventOccurrenceId !== undefined, (query) =>
        query.where("occurrence.id", "=", eventOccurrenceId as string),
      )
      .orderBy("occurrence.startsAt", "desc")
      .execute(),
    database
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
      .select([
        "participation.id as participationId",
        "participation.registrationId",
        "participation.mode",
        "participation.nameSnapshot as participationNameSnapshot",
        "participation.emailSnapshot as participationEmailSnapshot",
        "participation.createdAt as participationCreatedAt",
        "participation.checkedInAt",
        "participation.completedAt as participationCompletedAt",
        "occurrence.id as eventOccurrenceId",
        "occurrence.title",
        "occurrence.slug",
        "occurrence.status",
        "occurrence.deliveryMode",
        "occurrence.timezone",
        "occurrence.startsAt",
        "occurrence.endsAt",
        "occurrence.eventTemplateVersionId",
        "template.title as eventTemplateTitle",
        "version.version as eventTemplateVersion",
        "version.hasCompletionCertificate",
      ])
      .where("participation.userId", "=", userId)
      .$if(eventOccurrenceId !== undefined, (query) =>
        query.where("occurrence.id", "=", eventOccurrenceId as string),
      )
      .orderBy("occurrence.startsAt", "desc")
      .execute(),
  ]);

  const participationByRegistrationId = new Map(
    participations.flatMap((participation) =>
      participation.registrationId
        ? [[participation.registrationId, participation] as const]
        : [],
    ),
  );
  const usedParticipationIds = new Set<string>();
  type RegistrationRow = (typeof registrations)[number];
  type ParticipationRow = (typeof participations)[number];
  const records: Array<{
    registration: RegistrationRow | null;
    participation: ParticipationRow | null;
  }> = registrations.map((registration) => {
    const participation = participationByRegistrationId.get(
      registration.registrationId,
    );
    if (participation) usedParticipationIds.add(participation.participationId);
    return { registration, participation: participation ?? null };
  });
  records.push(
    ...participations
      .filter(
        (participation) =>
          !usedParticipationIds.has(participation.participationId),
      )
      .map((participation) => ({ registration: null, participation })),
  );
  if (records.length === 0) return [];

  const registrationIds = registrations.map(
    (registration) => registration.registrationId,
  );
  const participationIds = participations.map(
    (participation) => participation.participationId,
  );
  const realOccurrenceIds = [
    ...new Set(
      records.flatMap((record) => {
        const source = record.participation ?? record.registration;
        return source ? [source.eventOccurrenceId] : [];
      }),
    ),
  ];

  const [sessions, attendance, transitions, regionDecisions] =
    await Promise.all([
      includeDetails
        ? database
            .selectFrom("event_session")
            .select(["id", "eventOccurrenceId", "title", "startsAt", "endsAt"])
            .where("eventOccurrenceId", "in", realOccurrenceIds)
            .orderBy("position")
            .execute()
        : Promise.resolve([]),
      includeDetails && participationIds.length > 0
        ? database
            .selectFrom("event_attendance as attendance")
            .innerJoin(
              "event_session as session",
              "session.id",
              "attendance.eventSessionId",
            )
            .leftJoin(
              "user as actor",
              "actor.id",
              "attendance.recordedByUserId",
            )
            .select([
              "attendance.eventParticipationId",
              "attendance.eventSessionId",
              "attendance.state",
              "attendance.source",
              "attendance.recordedAt",
              "attendance.updatedAt",
              "actor.name as recordedByName",
            ])
            .where("attendance.eventParticipationId", "in", participationIds)
            .execute()
        : Promise.resolve([]),
      includeDetails && registrationIds.length > 0
        ? database
            .selectFrom("event_registration_transition as transition")
            .leftJoin("user as actor", "actor.id", "transition.actorUserId")
            .leftJoin(
              "event_occurrence_region as fromOccurrenceRegion",
              "fromOccurrenceRegion.id",
              "transition.fromEventOccurrenceRegionId",
            )
            .leftJoin(
              "coordination_region as fromRegion",
              "fromRegion.id",
              "fromOccurrenceRegion.regionId",
            )
            .leftJoin(
              "event_occurrence_region as toOccurrenceRegion",
              "toOccurrenceRegion.id",
              "transition.toEventOccurrenceRegionId",
            )
            .leftJoin(
              "coordination_region as toRegion",
              "toRegion.id",
              "toOccurrenceRegion.regionId",
            )
            .select([
              "transition.id",
              "transition.eventRegistrationId",
              "transition.fromStatus",
              "transition.toStatus",
              "transition.source",
              "transition.priority",
              "transition.occurredAt",
              "actor.name as actorName",
              "fromRegion.name as fromRegionName",
              "toRegion.name as toRegionName",
            ])
            .where("transition.eventRegistrationId", "in", registrationIds)
            .execute()
        : Promise.resolve([]),
      includeDetails && registrationIds.length > 0
        ? database
            .selectFrom("event_registration_region_decision as decision")
            .leftJoin("user as actor", "actor.id", "decision.decidedByUserId")
            .select([
              "decision.id",
              "decision.eventRegistrationId",
              "decision.resolution",
              "decision.reportingRegionNameSnapshot",
              "decision.reportingRegionGroupNameSnapshot",
              "decision.decidedAt",
              "actor.name as actorName",
            ])
            .where("decision.eventRegistrationId", "in", registrationIds)
            .execute()
        : Promise.resolve([]),
    ]);

  const auditSubjectIds = participations.flatMap((participation) =>
    sessions
      .filter(
        (session) =>
          session.eventOccurrenceId === participation.eventOccurrenceId,
      )
      .map((session) => `${participation.participationId}:${session.id}`),
  );
  const attendanceHistory =
    includeDetails && auditSubjectIds.length > 0
      ? await database
          .selectFrom("audit_event as audit")
          .leftJoin("user as actor", "actor.id", "audit.actorUserId")
          .select([
            "audit.id",
            "audit.subjectId",
            "audit.metadata",
            "audit.createdAt",
            "actor.name as actorName",
          ])
          .where("audit.action", "=", "event_attendance.recorded")
          .where("audit.subjectId", "in", auditSubjectIds)
          .execute()
      : [];

  const progressByParticipationId = new Map(
    (
      await Promise.all(
        includeDetails
          ? records.flatMap((record) => {
              const source = record.participation ?? record.registration;
              if (!record.participation || !source) return [];
              return [
                findEventParticipantProgress(
                  source.eventOccurrenceId,
                  source.eventTemplateVersionId,
                  source.startsAt.toISOString(),
                  source.endsAt.toISOString(),
                  source.timezone,
                  {
                    administrator: true,
                    coordinatorRegionIds: [],
                    participantUserId: userId,
                    includeInactiveRegistrations: true,
                  },
                ),
              ];
            })
          : [],
      )
    )
      .flat()
      .map((progress) => [progress.eventParticipationId, progress]),
  );

  return records
    .map((record): AdminLearnerEvent => {
      const source = record.participation ?? record.registration;
      if (!source)
        throw new Error("An event support record requires source evidence");
      const participation = record.participation;
      const registration = record.registration;
      const currentAttendance = new Map(
        attendance
          .filter(
            (row) =>
              row.eventParticipationId === participation?.participationId,
          )
          .map((row) => [row.eventSessionId, row]),
      );
      const eventSessions = participation
        ? sessions.filter(
            (session) => session.eventOccurrenceId === source.eventOccurrenceId,
          )
        : [];
      const attendanceSubjects = new Map(
        eventSessions.map((session) => [
          `${participation?.participationId ?? ""}:${session.id}`,
          session,
        ]),
      );
      const auditedAttendanceSubjects = new Set(
        attendanceHistory.map((audit) => audit.subjectId),
      );
      const history: Array<AdminLearnerEventHistoryItem> = [
        ...transitions
          .filter(
            (transition) =>
              transition.eventRegistrationId === registration?.registrationId,
          )
          .map((transition) => ({
            id: transition.id,
            kind: "registration" as const,
            occurredAt: transition.occurredAt.toISOString(),
            actorName: transition.actorName,
            source: transition.source,
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            fromRegionName: transition.fromRegionName,
            toRegionName: transition.toRegionName,
            priority: transition.priority,
          })),
        ...regionDecisions
          .filter(
            (decision) =>
              decision.eventRegistrationId === registration?.registrationId,
          )
          .map((decision) => ({
            id: decision.id,
            kind: "region_decision" as const,
            occurredAt: decision.decidedAt.toISOString(),
            actorName: decision.actorName,
            resolution: decision.resolution,
            reportingRegionName: decision.reportingRegionNameSnapshot,
            reportingRegionGroupName: decision.reportingRegionGroupNameSnapshot,
          })),
        ...attendanceHistory.flatMap((audit) => {
          const session = attendanceSubjects.get(audit.subjectId);
          const metadata = attendanceMetadata(audit.metadata);
          return session && metadata
            ? [
                {
                  id: audit.id,
                  kind: "attendance" as const,
                  occurredAt: audit.createdAt.toISOString(),
                  actorName: audit.actorName,
                  sessionTitle: session.title,
                  state: metadata.state,
                  source: metadata.source,
                },
              ]
            : [];
        }),
        ...attendance.flatMap((row) => {
          if (row.eventParticipationId !== participation?.participationId)
            return [];
          const subjectId = `${row.eventParticipationId}:${row.eventSessionId}`;
          const session = attendanceSubjects.get(subjectId);
          return session && !auditedAttendanceSubjects.has(subjectId)
            ? [
                {
                  id: `attendance-current:${subjectId}`,
                  kind: "attendance" as const,
                  occurredAt: row.recordedAt.toISOString(),
                  actorName: row.recordedByName,
                  sessionTitle: session.title,
                  state: row.state,
                  source: row.source,
                },
              ]
            : [];
        }),
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

      return {
        key:
          registration?.registrationId ??
          participation?.participationId ??
          source.eventOccurrenceId,
        occurrence: projectOccurrence(source),
        registration: registration
          ? {
              id: registration.registrationId,
              status: registration.registrationStatus,
              source: registration.registrationSource,
              eligibilitySource: registration.eligibilitySource,
              nameSnapshot: registration.registrationNameSnapshot,
              emailSnapshot: registration.registrationEmailSnapshot,
              submittedAt: registration.submittedAt.toISOString(),
              coordinatorDecidedAt:
                registration.coordinatorDecidedAt?.toISOString() ?? null,
              finalDecidedAt:
                registration.finalDecidedAt?.toISOString() ?? null,
              lockedInAt: registration.lockedInAt?.toISOString() ?? null,
              registrationRegion:
                registration.registrationRegionCode &&
                registration.registrationRegionName
                  ? {
                      code: registration.registrationRegionCode,
                      name: registration.registrationRegionName,
                    }
                  : null,
              reportingRegionSnapshot:
                registration.reportingRegionCodeSnapshot ||
                registration.reportingRegionNameSnapshot ||
                registration.reportingRegionGroupCodeSnapshot ||
                registration.reportingRegionGroupNameSnapshot
                  ? {
                      code: registration.reportingRegionCodeSnapshot,
                      name: registration.reportingRegionNameSnapshot,
                      groupCode: registration.reportingRegionGroupCodeSnapshot,
                      groupName: registration.reportingRegionGroupNameSnapshot,
                    }
                  : null,
            }
          : null,
        participation: participation
          ? {
              id: participation.participationId,
              mode: participation.mode,
              nameSnapshot: participation.participationNameSnapshot,
              emailSnapshot: participation.participationEmailSnapshot,
              createdAt: participation.participationCreatedAt.toISOString(),
              checkedInAt: participation.checkedInAt?.toISOString() ?? null,
              completedAt:
                participation.participationCompletedAt?.toISOString() ?? null,
            }
          : null,
        sessions: eventSessions.map((session) => {
          const recorded = currentAttendance.get(session.id);
          return {
            id: session.id,
            title: session.title,
            startsAt: session.startsAt.toISOString(),
            endsAt: session.endsAt.toISOString(),
            attendance: {
              state: recorded?.state ?? "not_recorded",
              source: recorded?.source ?? null,
              recordedAt: recorded?.recordedAt.toISOString() ?? null,
              updatedAt: recorded?.updatedAt.toISOString() ?? null,
              recordedByName: recorded?.recordedByName ?? null,
            },
          };
        }),
        progress: participation
          ? (progressByParticipationId.get(participation.participationId) ??
            null)
          : null,
        certificate: {
          offered: source.hasCompletionCertificate,
          eligible: Boolean(
            source.hasCompletionCertificate &&
            participation?.participationCompletedAt,
          ),
        },
        history,
      };
    })
    .sort((left, right) =>
      right.occurrence.startsAt.localeCompare(left.occurrence.startsAt),
    );
}

export async function findAdminLearnerEvents(
  userId: string,
): Promise<Array<AdminLearnerEvent>> {
  return await findAdminLearnerEventRecords(userId, { includeDetails: false });
}

export async function findAdminLearnerEventDetail(
  userId: string,
  eventOccurrenceId: string,
): Promise<AdminLearnerEventDetail | null> {
  const database = getDatabase();
  const [learner, events] = await Promise.all([
    database
      .selectFrom("user")
      .select(["id", "name", "email"])
      .where("id", "=", userId)
      .where(learnerPredicate())
      .executeTakeFirst(),
    findAdminLearnerEventRecords(userId, {
      eventOccurrenceId,
      includeDetails: true,
    }),
  ]);
  const event = events[0];
  return learner && event ? { learner, event } : null;
}
