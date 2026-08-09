import { z } from "zod";

const internalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);

export const scormLaunchInputSchema = z.object({
  enrollmentId: internalIdSchema,
  modulePosition: z.number().int().min(0).max(10_000),
});

export const scormAttemptParamsSchema = z.object({
  attemptId: internalIdSchema,
});

export const scormOpaqueTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);

const scoreSchema = z.number().min(-100_000).max(100_000).nullable();

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
    location: z.string().max(1_000),
    suspendData: z.string().max(65_536),
    scoreRaw: scoreSchema,
    scoreMin: scoreSchema,
    scoreMax: scoreSchema,
    totalTimeSeconds: z.number().int().nonnegative().max(31_536_000),
  })
  .superRefine((value, context) => {
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
  });

export type ScormProgressInput = z.infer<typeof scormProgressInputSchema>;

export type ScormLaunchResult =
  | { status: "ready"; launchUrl: string }
  | { status: "unavailable" }
  | { status: "not-found" }
  | { status: "unauthenticated" };
