import { z } from "#/validation/zod";
import type { LearnerRegistrationQuestionnaire } from "#/features/registration/registration-questionnaire.schema";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );

export const learnerEventWorkspaceInputSchema = z.object({
  eventOccurrenceId: identifierSchema,
});

export interface LearnerEventWorkspaceItem {
  id: string;
  position: number;
  kind: "session" | "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  completionState: "completed" | "incomplete";
  session: {
    id: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
    venueAddress: string | null;
    virtualJoinUrl: string | null;
    attendanceState: "not_recorded" | "checked_in" | "attended" | "absent";
  } | null;
  learningActivityVersionId: string | null;
}

export interface LearnerEventWorkspaceSection {
  id: string;
  position: number;
  title: string;
  description: string;
  phase: "pre_event" | "session" | "post_event" | "follow_up";
  available: boolean;
  releaseAt: string;
  completedItems: number;
  totalItems: number;
  completionState: "completed" | "incomplete" | "locked";
  items: Array<LearnerEventWorkspaceItem>;
}

interface LearnerEventWorkspace {
  eventOccurrenceId: string;
  eventParticipationId: string;
  title: string;
  eventTemplateTitle: string;
  summary: string;
  description: string;
  timezone: string;
  deliveryMode: "in_person" | "virtual";
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  venueAddress: string | null;
  completionState: "completed" | "incomplete";
  completedAt: string | null;
  certificateAvailable: boolean;
  sections: Array<LearnerEventWorkspaceSection>;
}

export type LearnerEventWorkspaceResult =
  | { status: "ready"; workspace: LearnerEventWorkspace }
  | { status: "cancelled"; title: string }
  | {
      status: "registration-required";
      questionnaire: LearnerRegistrationQuestionnaire;
    }
  | { status: "not-found" }
  | { status: "unauthenticated" };
