import { z } from "#/validation/zod";

export const accessCodeInputSchema = z.object({
  code: z
    .string()
    .check(
      z.trim(),
      z.minLength(8, "Enter the complete access code."),
      z.maxLength(128, "The access code is too long."),
    ),
});

export type AccessCodeRedemptionResult =
  | { status: "enrolled"; courseTitle: string }
  | { status: "already-enrolled"; courseTitle: string }
  | { status: "invalid" }
  | { status: "unauthenticated" };
