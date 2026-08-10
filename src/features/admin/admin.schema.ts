import { z } from "#/validation/zod";
import type { LearningPhase } from "#/features/learning/learning.schema";

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

export const adminEnrollmentParamsSchema = z.object({
  userId: adminIdentifierSchema,
  enrollmentId: adminIdentifierSchema,
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
}

export interface AdminLearnerDirectory {
  learners: Array<AdminLearnerSummary>;
  pagination: { page: number; pages: number; total: number };
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

export interface AdminLearnerProfile {
  learner: { id: string; name: string; email: string; joinedAt: string };
  enrollments: Array<AdminLearnerEnrollment>;
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
  latestActivityAtLabel: string | null;
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
  createdAtLabel: string;
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
    enrolledAtLabel: string;
    completedAt: string | null;
    completedAtLabel: string | null;
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

export type AdminProgressOverrideResult =
  AdminResult<{ outcome: "changed" | "unchanged" }> | { status: "not-found" };
