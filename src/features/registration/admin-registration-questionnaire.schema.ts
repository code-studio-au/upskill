import { z } from "#/validation/zod";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );

export const registrationQuestionnaireAdminTargetSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("course"),
      courseId: identifierSchema,
      enrollmentId: identifierSchema,
    }),
    z.object({
      kind: z.literal("event"),
      eventOccurrenceId: identifierSchema,
      registrationId: identifierSchema,
    }),
  ],
);

export const registrationQuestionnaireWaiverSchema = z.object({
  target: registrationQuestionnaireAdminTargetSchema,
  reason: z.string().check(z.trim(), z.minLength(2), z.maxLength(1_000)),
});

export type RegistrationQuestionnaireAdminTarget = z.infer<
  typeof registrationQuestionnaireAdminTargetSchema
>;

type RegistrationQuestionnaireAdminStatus =
  | "not_required"
  | "not_started"
  | "assigned"
  | "in_progress"
  | "completed"
  | "waived";

export interface RegistrationQuestionnaireAdminDetail {
  status: RegistrationQuestionnaireAdminStatus;
  surveyTitle: string | null;
  surveyVersion: number | null;
  assignedAt: string | null;
  completedAt: string | null;
  waivedAt: string | null;
  waivedByName: string | null;
  waiverReason: string | null;
  profileUpdateAccepted: boolean;
  answers: Array<{
    questionId: string;
    prompt: string;
    answer: string;
  }>;
}

export type RegistrationQuestionnaireAdminResult =
  | { status: "ready"; data: RegistrationQuestionnaireAdminDetail }
  | { status: "unauthenticated" | "forbidden" | "not-found" };

export type RegistrationQuestionnaireWaiverResult =
  | { status: "ready" }
  | {
      status: "unauthenticated" | "forbidden" | "not-found" | "conflict";
    };
