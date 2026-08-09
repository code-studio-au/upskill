import { z } from "zod";

export const accessCodeInputSchema = z.object({
  code: z.string().trim().min(8).max(128),
});

export type AccessCodeRedemptionResult =
  | { status: "enrolled"; courseTitle: string }
  | { status: "already-enrolled"; courseTitle: string }
  | { status: "invalid" }
  | { status: "unauthenticated" };
