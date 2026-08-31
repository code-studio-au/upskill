import { z } from "#/validation/zod";
import type { BulkPricing } from "#/features/catalog/catalog.schema";

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

export const adminEventRegistrationRegionReassignmentSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
  eventOccurrenceRegionId: identifier,
  confirmFinalizedReassignment: z.boolean(),
  confirmLockedDestinationReassignment: z.boolean(),
});

export const adminEventRegistrationProfileRegionAlignmentSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
});

export const adminEventRegistrationRegionGuestDecisionSchema = z.object({
  eventOccurrenceId: identifier,
  registrationId: identifier,
});

export const adminEventRegistrationRegionMismatchAcknowledgementSchema =
  z.object({
    eventOccurrenceId: identifier,
    registrationId: identifier,
  });

export const adminEventLateInvitationCreateSchema = z.object({
  eventOccurrenceId: identifier,
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
  email: z.email().check(z.maxLength(320)),
  eventOccurrenceRegionId: z.nullable(identifier),
  overrideDomainRestriction: z.boolean(),
  expiresInDays: z.number().check(z.int(), z.minimum(1), z.maximum(30)),
});

export const adminEventLateInvitationRevokeSchema = z.object({
  eventOccurrenceId: identifier,
  invitationId: identifier,
});

export const adminEventAttendanceSchema = z.object({
  eventOccurrenceId: identifier,
  eventSessionId: identifier,
  eventParticipationId: identifier,
  state: z.enum(["not_recorded", "checked_in", "attended", "absent"]),
});

export const adminEventAccountSetupSchema = z.object({
  eventOccurrenceId: identifier,
  userId: identifier,
});

export const adminEventLifecycleSchema = z.object({
  eventOccurrenceId: identifier,
  target: z.enum(["cancelled", "completed", "archived"]),
});

export const adminEventGuestAccessRotateSchema = z.object({
  eventOccurrenceId: identifier,
});

export const adminEventGuestAttendanceModeSchema = z.object({
  eventOccurrenceId: identifier,
  mode: z.enum(["checked_in", "attended"]),
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
      | "open_entry"
      | "paid_entry"
      | "required_unrestricted"
      | "required_restricted";
    approvalMode: "automatic" | "manual";
    timezone: string;
    localStartsAt: string;
    localEndsAt: string;
    localRegistrationOpensAt: string | null;
    localRegistrationClosesAt: string | null;
    localCoordinatorLockAt: string | null;
    startsAt: string;
    endsAt: string;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
    coordinatorLockAt: string | null;
    capacity: number;
    priceCents: number | null;
    salePriceCents: number | null;
    currency: "AUD";
    bulkPricing: BulkPricing;
    listInStore: boolean;
    featured: boolean;
    confirmedCount: number;
    venueName: string;
    venueAddress: string;
    virtualJoinUrl: string;
    domains: string;
    sessionCount: number;
    assignedAdminCount: number;
    openEntryAttendanceMode: "checked_in" | "attended";
  };
  guestAccess: {
    publicReference: string;
    generation: number;
    createdAt: string;
  } | null;
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
    source:
      | "ordinary"
      | "paid_checkout"
      | "access_code"
      | "enterprise_contract"
      | "late_invitation"
      | "administrator_override";
    eligibilitySource:
      | "unrestricted"
      | "paid"
      | "access_code"
      | "enterprise_contract"
      | "verified_domain"
      | "administrator_override";
    status: EventRegistrationStatus;
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
    submittedAt: string;
    coordinatorDecidedAt: string | null;
    finalDecidedAt: string | null;
    finalDecisionLocked: boolean;
    accountState: "provisional" | "active";
    setupRequestedAt: string | null;
  }>;
  invitations: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    regionName: string | null;
    createdAt: string;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
    status: "accepted" | "expired" | "pending" | "revoked";
  }>;
  regions: Array<{
    id: string;
    regionId: string;
    name: string;
    code: string;
    lockedAt: string | null;
    effectivelyLocked: boolean;
    registrationCount: number;
    selectedCount: number;
    affectedActiveCount: number;
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
      mode: "registered" | "open_entry";
      detailsSubmittedAt: string | null;
      joinDisclosedAt: string | null;
      checkedInAt: string | null;
      state: "not_recorded" | "checked_in" | "attended" | "absent";
      updatedAt: string | null;
    }>;
  }>;
  administrators: Array<EventPerson>;
  availableUsers: Array<EventPerson>;
  availableCoordinators: Array<EventPerson & { regionId: string }>;
  availableRegions: Array<{
    id: string;
    name: string;
    code: string;
    parentName: string | null;
  }>;
  reschedules: Array<{
    id: string;
    registrationWindowPolicy: "keep" | "replace_future" | "reopen";
    previousStartsAt: string;
    previousEndsAt: string;
    nextStartsAt: string;
    nextEndsAt: string;
    actorName: string;
    createdAt: string;
    regionCount: number;
    coordinatorCount: number;
  }>;
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
    fromRegionName: string | null;
    toRegionName: string | null;
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
        | "final_decision_locked"
        | "finalized_reassignment_confirmation_required"
        | "locked_destination_reassignment_confirmation_required"
        | "region_mismatch_resolved"
        | "region_locked"
        | "capacity_full"
        | "registration_unavailable"
        | "domain_override_required"
        | "duplicate_registration"
        | "account_already_active"
        | "attendance_unavailable";
    };
