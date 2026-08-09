import { z } from "zod";

const enrollmentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);

export const learnerWorkspaceInputSchema = z.object({
  enrollmentId: enrollmentIdSchema,
});

export type LearningPhase =
  "pre-learning" | "content" | "post-learning" | "followup";

export interface LearnerWorkspaceModule {
  position: number;
  title: string;
  phase: LearningPhase;
  durationMinutes: number;
}

interface LearnerWorkspace {
  enrollmentId: string;
  courseSlug: string;
  courseTitle: string;
  courseSummary: string;
  completionStatus: "incomplete" | "completed";
  enrolledAt: string;
  expiresAt: string | null;
  modules: Array<LearnerWorkspaceModule>;
}

export type LearnerWorkspaceResult =
  | { status: "available"; workspace: LearnerWorkspace }
  | { status: "expired"; courseSlug: string }
  | { status: "removed"; courseSlug: string }
  | { status: "not-found" }
  | { status: "unauthenticated" };
