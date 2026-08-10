import { z } from "#/validation/zod";

const enrollmentIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );

export const learnerWorkspaceInputSchema = z.object({
  enrollmentId: enrollmentIdSchema,
});

export const learnerResourceInputSchema = z.object({
  enrollmentId: enrollmentIdSchema,
  resourceVersionId: enrollmentIdSchema,
});

export type LearningPhase =
  "pre-learning" | "content" | "post-learning" | "followup";

interface LearnerWorkspaceModule {
  position: number;
  title: string;
  phase: LearningPhase;
  durationMinutes: number;
  completionState: "completed" | "incomplete";
}

export interface LearnerWorkspaceItem {
  id: string;
  position: number;
  kind: "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  completionState: "completed" | "incomplete";
  modulePosition: number | null;
  resourceVersionId: string | null;
}

interface LearnerWorkspaceSection {
  id: string;
  position: number;
  title: string;
  description: string;
  completedItems: number;
  totalItems: number;
  completedRequiredItems: number;
  requiredItems: number;
  completionState: "completed" | "incomplete";
  items: Array<LearnerWorkspaceItem>;
}

interface LearnerWorkspace {
  enrollmentId: string;
  courseSlug: string;
  courseTitle: string;
  courseSummary: string;
  completionStatus: "incomplete" | "completed";
  enrolledOn: string;
  expiresOn: string | null;
  modules: Array<LearnerWorkspaceModule>;
  sections: Array<LearnerWorkspaceSection>;
}

export type LearnerWorkspaceResult =
  | { status: "available"; workspace: LearnerWorkspace }
  | { status: "expired"; courseSlug: string }
  | { status: "removed"; courseSlug: string }
  | { status: "not-found" }
  | { status: "unauthenticated" };
