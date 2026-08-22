import { z } from "#/validation/zod";

const publicReference = z
  .string()
  .check(z.length(32), z.regex(/^[A-Za-z0-9_-]+$/u));

export const eventRecoveryReferenceSchema = z.object({ publicReference });

export const eventRecoveryRequestSchema = z.object({
  publicReference,
  identifier: z.string().check(
    z.trim(),
    z.maxLength(320),
    z.refine(
      (value) =>
        z.email().safeParse(value).success ||
        /^\+[1-9][\d ()-]{7,22}$/u.test(value),
      "Enter a valid email address or mobile number in international format.",
    ),
  ),
});

export const eventRecoveryVerificationSchema = z.object({
  publicReference,
  challengeReference: publicReference,
  code: z.string().check(z.regex(/^\d{6}$/u, "Enter the six-digit code.")),
});

export type EventRecoveryLandingResult =
  | { status: "not-found" }
  | { status: "unavailable" }
  | {
      status: "ready";
      data: {
        eventOccurrenceId: string;
        eventTemplateVersionItemId: string;
      };
    }
  | {
      status: "recovery-required";
      data: {
        eventTitle: string;
        sectionTitle: string;
        surveyTitle: string;
      };
    };

export type EventRecoveryRequestResult =
  | { status: "accepted"; challengeReference: string }
  | { status: "rate-limited" | "unavailable" };

export type EventRecoveryVerificationResult =
  | {
      status: "ready";
      data: {
        eventOccurrenceId: string;
        eventTemplateVersionItemId: string;
      };
    }
  | { status: "invalid" | "expired" | "rate-limited" | "unavailable" };
