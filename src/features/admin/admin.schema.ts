import { z } from "#/validation/zod";
import type { LearningPhase } from "#/features/learning/learning.schema";
import type { EventParticipantProgress } from "#/features/event-operations/event-operations.schema";
import { accountInvitationSchema } from "#/features/auth/account-invitation.schema";

const adminIdentifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );

export const adminLearnerSearchSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  page: z.catch(
    z.coerce.number().check(z.int(), z.minimum(1), z.maximum(10_000)),
    1,
  ),
});

export const adminLearnerParamsSchema = z.object({
  userId: adminIdentifierSchema,
});

export const adminAccountInviteSchema = accountInvitationSchema;

export const adminAdministratorRemoveSchema = z.object({
  userId: adminIdentifierSchema,
});

export const adminRequireReOnboardingSchema = z.object({
  userId: adminIdentifierSchema,
});

export const adminEnrollmentParamsSchema = z.object({
  userId: adminIdentifierSchema,
  enrollmentId: adminIdentifierSchema,
});

export const adminLearnerEventParamsSchema = z.object({
  userId: adminIdentifierSchema,
  eventOccurrenceId: adminIdentifierSchema,
});

const progressOverrideFields = {
  enrollmentId: adminIdentifierSchema,
  state: z.enum(["completed", "incomplete"]),
};

export const adminProgressOverrideInputSchema = z.discriminatedUnion("scope", [
  z.object({
    ...progressOverrideFields,
    scope: z.literal("enrollment"),
    modulePosition: z._default(z.optional(z.null()), null),
  }),
  z.object({
    ...progressOverrideFields,
    scope: z.literal("module"),
    modulePosition: z.coerce
      .number()
      .check(z.int(), z.minimum(0), z.maximum(10_000)),
  }),
]);

export type AdminLearnerSearch = z.infer<typeof adminLearnerSearchSchema>;
export type AdminProgressOverrideInput = z.infer<
  typeof adminProgressOverrideInputSchema
>;

export interface AdminOverview {
  administrator: { name: string; email: string };
  statistics: {
    learners: number;
    activeEnrollments: number;
    completedEnrollments: number;
    paidOrders: number;
    paidRevenueCents: number;
  };
}

interface AdminLearnerSummary {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  enrollments: number;
  activeEnrollments: number;
  completedEnrollments: number;
  accountState: "provisional" | "active";
}

export interface AdminAdministratorDirectory {
  currentUserId: string;
  administrators: Array<{
    userId: string;
    name: string;
    email: string;
    status: "active" | "pending";
    since: string;
  }>;
}

export type AdminAccountInviteInput = z.infer<typeof adminAccountInviteSchema>;

export type AdminAccountInviteResult =
  | AdminResult<{
      outcome: "invited" | "resent" | "existing" | "granted" | "pending";
      userId: string;
    }>
  | { status: "conflict"; reason: "already_administrator" };

export type AdminAdministratorRemoveResult =
  | AdminResult<{ outcome: "revoked" | "invitation_cancelled" }>
  | { status: "not-found" }
  | {
      status: "conflict";
      reason: "self" | "last_administrator" | "event_responsibility";
      eventAssignmentCount?: number;
      templateDefaultCount?: number;
    };

export interface AdminLearnerDirectory {
  learners: Array<AdminLearnerSummary>;
  pagination: { page: number; pages: number; total: number; pageSize: number };
  query: string;
}

interface AdminLearnerEnrollment {
  id: string;
  courseSlug: string;
  courseTitle: string;
  courseVersion: number;
  status: "active" | "completed" | "expired" | "cancelled";
  enrolledAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  removedAt: string | null;
  moduleCount: number;
  completedModuleCount: number;
  lastActivityAt: string | null;
}

export type AdminLearnerEventHistoryItem =
  | {
      id: string;
      kind: "registration";
      occurredAt: string;
      actorName: string | null;
      source:
        "learner" | "automatic" | "coordinator" | "administrator" | "deadline";
      fromStatus: string | null;
      toStatus: string;
      fromRegionName: string | null;
      toRegionName: string | null;
      priority: number | null;
    }
  | {
      id: string;
      kind: "region_decision";
      occurredAt: string;
      actorName: string | null;
      resolution:
        | "registered_region_confirmed"
        | "profile_region_confirmed"
        | "profile_aligned_to_registration"
        | "region_guest_confirmed";
      reportingRegionName: string | null;
      reportingRegionGroupName: string | null;
    }
  | {
      id: string;
      kind: "attendance";
      occurredAt: string;
      actorName: string | null;
      sessionTitle: string;
      state: "not_recorded" | "checked_in" | "attended" | "absent";
      source:
        | "system"
        | "self_check_in"
        | "coordinator"
        | "presenter"
        | "administrator";
    };

export interface AdminLearnerEvent {
  key: string;
  occurrence: {
    id: string;
    title: string;
    slug: string;
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    deliveryMode: "in_person" | "virtual";
    timezone: string;
    startsAt: string;
    endsAt: string;
    eventTemplateTitle: string;
    eventTemplateVersion: number;
  };
  registration: {
    id: string;
    status:
      | "submitted"
      | "coordinator_approved"
      | "coordinator_declined"
      | "selected"
      | "waitlisted"
      | "not_selected"
      | "withdrawn"
      | "cancelled";
    source:
      | "ordinary"
      | "paid_checkout"
      | "access_code"
      | "late_invitation"
      | "administrator_override";
    eligibilitySource:
      | "unrestricted"
      | "paid"
      | "access_code"
      | "verified_domain"
      | "administrator_override";
    nameSnapshot: string;
    emailSnapshot: string;
    submittedAt: string;
    coordinatorDecidedAt: string | null;
    finalDecidedAt: string | null;
    lockedInAt: string | null;
    registrationRegion: {
      code: string;
      name: string;
    } | null;
    reportingRegionSnapshot: {
      code: string | null;
      name: string | null;
      groupCode: string | null;
      groupName: string | null;
    } | null;
  } | null;
  participation: {
    id: string;
    mode: "registered" | "open_entry";
    nameSnapshot: string;
    emailSnapshot: string;
    createdAt: string;
    checkedInAt: string | null;
    completedAt: string | null;
  } | null;
  sessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    attendance: {
      state: "not_recorded" | "checked_in" | "attended" | "absent";
      source:
        | "system"
        | "self_check_in"
        | "coordinator"
        | "presenter"
        | "administrator"
        | null;
      recordedAt: string | null;
      updatedAt: string | null;
      recordedByName: string | null;
    };
  }>;
  progress: EventParticipantProgress | null;
  certificate: { offered: boolean; eligible: boolean };
  history: Array<AdminLearnerEventHistoryItem>;
}

export interface AdminLearnerProfile {
  learner: {
    id: string;
    name: string;
    email: string;
    emailEnabled: boolean;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    phone: string | null;
    smsEnabled: boolean;
    smsVerifiedAt: string | null;
    joinedAt: string;
  };
  onboarding: {
    activeConfiguration: {
      definitionVersionId: string;
      definitionVersion: number;
      surveyTitle: string;
      surveyVersion: number;
    } | null;
    canRequire: boolean;
    assignments: Array<{
      id: string;
      status: "assigned" | "in_progress" | "completed" | "superseded";
      source: "automatic" | "administrator" | "campaign";
      definitionVersion: number;
      surveyTitle: string;
      surveyVersion: number;
      assignedAt: string;
      startedAt: string | null;
      completedAt: string | null;
      supersededAt: string | null;
    }>;
  };
  enrollments: Array<AdminLearnerEnrollment>;
  events: Array<AdminLearnerEvent>;
}

export interface AdminLearnerEventDetail {
  learner: { id: string; name: string; email: string };
  event: AdminLearnerEvent;
}

interface AdminEnrollmentModule {
  position: number;
  title: string;
  phase: LearningPhase;
  durationMinutes: number;
  state: "completed" | "incomplete";
  source: "scorm" | "administrator" | "none";
  attemptCount: number;
  latestActivityAt: string | null;
}

interface AdminEnrollmentSectionItem {
  id: string;
  kind: "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  state: "completed" | "incomplete";
}

interface AdminEnrollmentSection {
  id: string;
  title: string;
  description: string;
  state: "completed" | "incomplete";
  completedItems: number;
  totalItems: number;
  items: Array<AdminEnrollmentSectionItem>;
}

interface AdminProgressOverrideHistoryItem {
  id: string;
  scope: "module" | "enrollment";
  modulePosition: number | null;
  state: "completed" | "incomplete";
  administratorName: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminEnrollmentDetail {
  learner: { id: string; name: string; email: string };
  enrollment: {
    id: string;
    courseTitle: string;
    courseVersion: number;
    accessStatus: "active" | "expired" | "cancelled";
    completionState: "completed" | "incomplete";
    completionSource: "system" | "administrator";
    enrolledAt: string;
    completedAt: string | null;
    expiresAt: string | null;
  };
  modules: Array<AdminEnrollmentModule>;
  sections: Array<AdminEnrollmentSection>;
  overrideHistory: Array<AdminProgressOverrideHistoryItem>;
}

export type AdminResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminProfileResult =
  AdminResult<AdminLearnerProfile> | { status: "not-found" };

export type AdminEnrollmentResult =
  AdminResult<AdminEnrollmentDetail> | { status: "not-found" };

export type AdminLearnerEventResult =
  AdminResult<AdminLearnerEventDetail> | { status: "not-found" };

export type AdminProgressOverrideResult =
  AdminResult<{ outcome: "changed" | "unchanged" }> | { status: "not-found" };

export type AdminRequireReOnboardingResult =
  | AdminResult<{ outcome: "assigned" }>
  | { status: "not-found" }
  | {
      status: "conflict";
      reason: "no_active_onboarding" | "onboarding_already_required";
    };
