import { z } from "#/validation/zod";

type EnrollmentState = "active" | "completed" | "expired" | "cancelled";

export const learnerEventRegistrationSchema = z.object({
  eventOccurrenceId: z
    .string()
    .check(z.trim(), z.minLength(1), z.maxLength(200)),
  eventOccurrenceRegionId: z.optional(
    z.nullable(z.string().check(z.trim(), z.minLength(1), z.maxLength(255))),
  ),
});

type LearnerEventRegistrationStatus =
  | "submitted"
  | "coordinator_approved"
  | "coordinator_declined"
  | "selected"
  | "waitlisted"
  | "not_selected"
  | "withdrawn"
  | "cancelled";

export interface LearnerEvent {
  eventOccurrenceId: string;
  slug: string;
  title: string;
  eventTemplateTitle: string;
  deliveryMode: "in_person" | "virtual";
  timezone: string;
  startsAt: string;
  endsAt: string;
  registrationStatus: LearnerEventRegistrationStatus | null;
  canRegister: boolean;
  registrationUnavailableReason: "not_open" | "closed" | "full" | null;
  regions: Array<{ id: string; name: string }>;
}

export interface LearnerCourse {
  enrollmentId: string;
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  state: EnrollmentState;
  enrolledAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  certificate: {
    enrollmentId: string;
  } | null;
}

export interface AvailableCourse {
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  domain: string;
}

export interface LearnerDashboard {
  user: {
    id: string;
    name: string;
    email: string;
  };
  courses: Array<LearnerCourse>;
  availableCourses: Array<AvailableCourse>;
}

export interface LearnerEventsDashboard {
  events: Array<LearnerEvent>;
}
