import { z } from "#/validation/zod";

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );

export const scormLaunchInputSchema = z.object({
  enrollmentId: internalIdSchema,
  modulePosition: z.number().check(z.int(), z.minimum(0), z.maximum(10_000)),
});

export const scormAttemptParamsSchema = z.object({
  attemptId: internalIdSchema,
});

export const scormOpaqueTokenSchema = z
  .string()
  .check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/));

const scoreSchema = z.nullable(
  z.number().check(z.minimum(-100_000), z.maximum(100_000)),
);

export const scormProgressInputSchema = z
  .object({
    lessonStatus: z.enum([
      "not_attempted",
      "incomplete",
      "completed",
      "passed",
      "failed",
      "browsed",
    ]),
    location: z.string().check(z.maxLength(1_000)),
    suspendData: z.string().check(z.maxLength(65_536)),
    scoreRaw: scoreSchema,
    scoreMin: scoreSchema,
    scoreMax: scoreSchema,
    totalTimeSeconds: z
      .number()
      .check(z.int(), z.nonnegative(), z.maximum(31_536_000)),
  })
  .check(
    z.superRefine((value, context) => {
      if (
        value.scoreMin !== null &&
        value.scoreMax !== null &&
        value.scoreMin > value.scoreMax
      ) {
        context.addIssue({
          code: "custom",
          path: ["scoreMin"],
          message: "Minimum score cannot exceed maximum score",
        });
      }
      if (
        value.scoreRaw !== null &&
        ((value.scoreMin !== null && value.scoreRaw < value.scoreMin) ||
          (value.scoreMax !== null && value.scoreRaw > value.scoreMax))
      ) {
        context.addIssue({
          code: "custom",
          path: ["scoreRaw"],
          message: "Raw score must be within the supplied range",
        });
      }
    }),
  );

export type ScormProgressInput = z.infer<typeof scormProgressInputSchema>;

export type ScormLaunchResult =
  | { status: "ready"; launchUrl: string }
  | { status: "unavailable" }
  | { status: "not-found" }
  | { status: "unauthenticated" };
