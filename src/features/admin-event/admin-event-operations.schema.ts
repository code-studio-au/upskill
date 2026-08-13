import { z } from "#/validation/zod";

const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));

export const adminEventOccurrenceOperationsParamsSchema = z.object({
  eventOccurrenceId: identifier,
});

export const adminEventCoordinatorDecisionSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
  decision: z.enum(["coordinator_approved", "coordinator_declined"]),
  priority: z.nullable(
    z.number().check(z.int(), z.minimum(0), z.maximum(1_000_000)),
  ),
});

export const adminEventRegionLockSchema = z.object({
  eventOccurrenceId: identifier,
  eventOccurrenceRegionId: identifier,
});

export const adminEventFinalDecisionSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
  decision: z.enum(["selected", "waitlisted", "not_selected", "cancelled"]),
});

export const adminEventAddRegistrationSchema = z.object({
  eventOccurrenceId: identifier,
  userId: identifier,
  eventOccurrenceRegionId: z.nullable(identifier),
  overrideDomainRestriction: z.boolean(),
});

export const adminEventAttendanceSchema = z.object({
  eventOccurrenceId: identifier,
  eventSessionId: identifier,
  eventParticipationId: identifier,
  state: z.enum(["not_recorded", "checked_in", "attended", "absent"]),
});

export const adminEventLifecycleSchema = z.object({
  eventOccurrenceId: identifier,
  target: z.enum(["cancelled", "completed", "archived"]),
});

export type EventRegistrationStatus =
  | "submitted"
  | "coordinator_approved"
  | "coordinator_declined"
  | "selected"
  | "waitlisted"
  | "not_selected"
  | "withdrawn"
  | "cancelled";

interface EventPerson {
  id: string;
  name: string;
  email: string;
}

export interface AdminEventOccurrenceOperations {
  occurrence: {
    id: string;
    eventTemplateVersionId: string;
    eventTemplateId: string;
    title: string;
    slug: string;
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    templateTitle: string;
    templateVersion: number;
    deliveryMode: "in_person" | "virtual";
    registrationMode:
      "open_entry" | "required_unrestricted" | "required_restricted";
    approvalMode: "automatic" | "manual";
    timezone: string;
    startsAt: string;
    endsAt: string;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
    coordinatorLockAt: string | null;
    capacity: number;
    confirmedCount: number;
    venueName: string;
    venueAddress: string;
    virtualJoinUrl: string;
    domains: string;
    sessionCount: number;
    assignedAdminCount: number;
  };
  metrics: {
    total: number;
    submitted: number;
    candidates: number;
    selected: number;
    remainingCapacity: number;
  };
  registrations: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    source: "ordinary" | "late_invitation" | "administrator_override";
    eligibilitySource:
      "unrestricted" | "verified_domain" | "administrator_override";
    status: EventRegistrationStatus;
    regionId: string | null;
    regionName: string | null;
    reviewRoundId: string | null;
    coordinatorPriority: number | null;
    submittedAt: string;
    coordinatorDecidedAt: string | null;
    finalDecidedAt: string | null;
  }>;
  regions: Array<{
    id: string;
    regionId: string;
    name: string;
    code: string;
    lockedAt: string | null;
    effectivelyLocked: boolean;
    registrationCount: number;
    coordinators: Array<EventPerson>;
  }>;
  sessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    presenters: Array<EventPerson>;
    attendance: Array<{
      eventParticipationId: string;
      name: string;
      email: string;
      state: "not_recorded" | "checked_in" | "attended" | "absent";
      updatedAt: string | null;
    }>;
  }>;
  administrators: Array<EventPerson>;
  availableUsers: Array<EventPerson>;
  activity: Array<{
    id: string;
    registrationId: string;
    learnerName: string;
    fromStatus: EventRegistrationStatus | null;
    toStatus: EventRegistrationStatus;
    source:
      "learner" | "automatic" | "coordinator" | "administrator" | "deadline";
    actorName: string | null;
    priority: number | null;
    occurredAt: string;
  }>;
}

export type AdminEventOperationsResult =
  | { status: "ready"; data: AdminEventOccurrenceOperations }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" };

export type AdminEventOperationsMutationResult =
  | { status: "ready" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "invalid_transition"
        | "region_locked"
        | "capacity_full"
        | "registration_unavailable"
        | "domain_override_required"
        | "duplicate_registration"
        | "attendance_unavailable";
    };
