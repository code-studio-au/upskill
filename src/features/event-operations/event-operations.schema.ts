import { z } from "#/validation/zod";
import type { EventRegistrationStatus } from "#/features/admin-event/admin-event-operations.schema";

const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));

export const eventOperationsParamsSchema = z.object({
  eventOccurrenceId: identifier,
});

export const eventSurveyQrPresentationParamsSchema = z.object({
  eventOccurrenceId: identifier,
  eventSurveyAccessId: identifier,
});

export const eventSurveyPublicReferenceSchema = z.object({
  publicReference: z.string().check(z.length(32), z.regex(/^[A-Za-z0-9_-]+$/u)),
});

export const eventOperationsCoordinatorDecisionSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
  decision: z.enum(["coordinator_approved", "coordinator_declined"]),
  priority: z.nullable(
    z.number().check(z.int(), z.minimum(0), z.maximum(1_000_000)),
  ),
});

export const eventOperationsRegionLockSchema = z.object({
  eventOccurrenceId: identifier,
  eventOccurrenceRegionId: identifier,
});

export const eventOperationsAttendanceSchema = z.object({
  eventOccurrenceId: identifier,
  eventSessionId: identifier,
  eventParticipationId: identifier,
  state: z.enum(["not_recorded", "checked_in", "attended", "absent"]),
});

export const eventVirtualRoomMutationSchema = z.object({
  eventOccurrenceId: identifier,
  eventSessionId: identifier,
  action: z.enum([
    "prepare",
    "health",
    "start",
    "lock",
    "reopen",
    "end",
    "replace",
    "admission_manual",
    "admission_automatic",
  ]),
});

export const eventProgressFilterSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  state: z.catch(
    z.enum(["all", "not_started", "in_progress", "up_to_date", "completed"]),
    "all",
  ),
});

export type EventProgressFilter = z.infer<typeof eventProgressFilterSchema>;
export type EventParticipantProgressState =
  "not_started" | "in_progress" | "up_to_date" | "completed";
export type EventSectionProgressState =
  "locked" | "not_started" | "in_progress" | "completed";
export type EventAttendanceState =
  "not_recorded" | "checked_in" | "attended" | "absent";

export interface EventParticipantProgress {
  eventParticipationId: string;
  name: string;
  email: string;
  regionId: string | null;
  regionName: string | null;
  state: EventParticipantProgressState;
  completedAt: string | null;
  completedAvailableItems: number;
  availableItems: number;
  totalItems: number;
  sections: Array<{
    id: string;
    title: string;
    description: string;
    phase: "pre_event" | "session" | "post_event" | "follow_up";
    state: EventSectionProgressState;
    releaseAt: string;
    completedItems: number;
    totalItems: number;
    items: Array<{
      id: string;
      title: string;
      kind: "session" | "scorm" | "survey" | "resource";
      required: boolean;
      state: "completed" | "incomplete";
      eventSessionId: string | null;
    }>;
  }>;
}

export interface AssignedEventOperationsSummary {
  id: string;
  title: string;
  status: "draft" | "published" | "cancelled" | "completed" | "archived";
  deliveryMode: "in_person" | "virtual";
  timezone: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  roles: Array<"administrator" | "coordinator" | "presenter">;
  regions: Array<string>;
  sessions: Array<string>;
}

export interface EventOperationsWorkspace {
  occurrence: {
    id: string;
    title: string;
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    deliveryMode: "in_person" | "virtual";
    virtualDeliveryProvider: "external_url" | "livekit" | null;
    timezone: string;
    startsAt: string;
    endsAt: string;
    venueName: string;
    venueAddress: string;
    virtualJoinUrl: string;
    capacity: number;
    confirmedCount: number;
  };
  guestAccess: {
    publicReference: string;
    generation: number;
    createdAt: string;
  } | null;
  access: {
    roles: Array<"administrator" | "coordinator" | "presenter">;
    canReviewRegistrations: boolean;
    canViewRegistrations: boolean;
    canRecordAttendance: boolean;
    canViewProgress: boolean;
    canViewSurveyQrCatalogue: boolean;
  };
  metrics: {
    registrations: number;
    awaitingReview: number;
    candidates: number;
    confirmed: number;
    completed: number;
    upToDate: number;
    preWorkAttention: number;
  };
  regions: Array<{
    id: string;
    regionId: string;
    name: string;
    code: string;
    effectivelyLocked: boolean;
    registrationCount: number;
  }>;
  registrations: Array<{
    id: string;
    name: string;
    email: string;
    status: EventRegistrationStatus;
    registrationQuestionnaireStatus:
      | "not_required"
      | "not_started"
      | "assigned"
      | "in_progress"
      | "completed"
      | "waived";
    regionId: string | null;
    regionName: string | null;
    profileRegionId: string | null;
    profileRegionName: string | null;
    regionMismatch: boolean;
    regionMismatchAcknowledged: boolean;
    regionDecision: {
      id: string;
      resolution:
        | "registered_region_confirmed"
        | "profile_region_confirmed"
        | "profile_aligned_to_registration"
        | "region_guest_confirmed";
      classification:
        "event_region" | "outside_event_region" | "no_region_guest";
      reportingRegionId: string | null;
      reportingRegionCodeSnapshot: string | null;
      reportingRegionNameSnapshot: string | null;
      reportingRegionGroupCodeSnapshot: string | null;
      reportingRegionGroupNameSnapshot: string | null;
      decidedAt: string;
    } | null;
    regionalReviewWaivedAt: string | null;
    reviewRoundId: string | null;
    coordinatorPriority: number | null;
    coordinatorDecidedAt: string | null;
    finalDecidedAt: string | null;
  }>;
  sessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    canRecordAttendance: boolean;
    attendance: Array<{
      eventParticipationId: string;
      name: string;
      email: string;
      state: EventAttendanceState;
    }>;
  }>;
  virtualSessions: Array<{
    eventSessionId: string;
    preparationOpensAt: string;
    canEnterGreenRoom: boolean;
    room: {
      id: string;
      eventSessionId: string;
      generation: number;
      maxParticipants: number;
      doorState: "scheduled" | "open" | "locked" | "ended";
      admissionMode: "manual" | "automatic";
      providerStatus: "pending" | "ready" | "error" | "closed";
      providerErrorCode: string | null;
      createdAt: string;
      startedAt: string | null;
      lockedAt: string | null;
      reopenedAt: string | null;
      endedAt: string | null;
    } | null;
  }>;
  participantProgress: Array<EventParticipantProgress>;
  surveyQrCatalogue: Array<EventSurveyQrCatalogueItem>;
}

export interface EventSurveyQrCatalogueItem {
  id: string;
  publicReference: string;
  title: string;
  sectionTitle: string;
  phase: "pre_event" | "session" | "post_event" | "follow_up";
  releaseAnchor:
    | "participation_created"
    | "occurrence_start"
    | "occurrence_end"
    | "final_session_end";
  releaseOffsetAmount: number;
  releaseOffsetUnit: "minute" | "hour" | "day" | "week" | "month";
  status: "preview" | "active" | "disabled";
}

export interface EventSurveyQrPresentation {
  occurrenceId: string;
  occurrenceTitle: string;
  timezone: string;
  access: EventSurveyQrCatalogueItem;
}

export type AssignedEventOperationsResult =
  | { status: "ready"; data: Array<AssignedEventOperationsSummary> }
  | { status: "unauthenticated" };

export type EventOperationsResult =
  | { status: "ready"; data: EventOperationsWorkspace }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" };

export type EventOperationsMutationResult =
  | { status: "ready" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "attendance_unavailable"
        | "capacity_exceeded"
        | "invalid_transition"
        | "not_livekit"
        | "occurrence_unavailable"
        | "preparation_not_open"
        | "provider_pending"
        | "provider_unavailable"
        | "recording_unavailable"
        | "region_locked"
        | "room_configuration_changed"
        | "room_not_ready"
        | "session_ended";
    };

export type EventSurveyQrPresentationResult =
  | { status: "ready"; data: EventSurveyQrPresentation }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" };

export type LearnerEventSurveyReferenceResult =
  | {
      status: "ready";
      eventOccurrenceId: string;
      eventTemplateVersionItemId: string;
    }
  | { status: "unauthenticated" }
  | { status: "unavailable" }
  | { status: "not-found" };
