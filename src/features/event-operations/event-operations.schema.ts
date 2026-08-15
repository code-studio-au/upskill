import { z } from "#/validation/zod";
import type { EventRegistrationStatus } from "#/features/admin-event/admin-event-operations.schema";

const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));

export const eventOperationsParamsSchema = z.object({
  eventOccurrenceId: identifier,
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
    timezone: string;
    startsAt: string;
    endsAt: string;
    venueName: string;
    venueAddress: string;
    virtualJoinUrl: string;
    capacity: number;
    confirmedCount: number;
  };
  access: {
    roles: Array<"administrator" | "coordinator" | "presenter">;
    canReviewRegistrations: boolean;
    canViewRegistrations: boolean;
    canRecordAttendance: boolean;
    canViewProgress: boolean;
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
    regionId: string | null;
    regionName: string | null;
    reviewRoundId: string | null;
    coordinatorPriority: number | null;
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
      state: "not_recorded" | "checked_in" | "attended" | "absent";
    }>;
  }>;
  participantProgress: Array<EventParticipantProgress>;
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
      reason: "invalid_transition" | "region_locked" | "attendance_unavailable";
    };
