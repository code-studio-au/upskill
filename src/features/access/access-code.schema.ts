import { z } from "#/validation/zod";

const accessCodeSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(8, "Enter the complete access code."),
    z.maxLength(128, "The access code is too long."),
  );

export const accessCodeInputSchema = z.object({ code: accessCodeSchema });

export const INFORMATION_RELEASE_NOTICE_VERSION = "access-owner-v1";

export const accessCodeRedemptionSchema = z.object({
  code: accessCodeSchema,
  informationReleaseAccepted: z.literal(true),
  noticeVersion: z.literal(INFORMATION_RELEASE_NOTICE_VERSION),
});

export type AccessCodePreviewResult =
  | {
      status: "ready";
      offeringTitle: string;
      offeringType: "course" | "event";
      organizationName: string;
      accessKind: "bulk_purchase" | "enterprise_contract";
      noticeVersion: typeof INFORMATION_RELEASE_NOTICE_VERSION;
    }
  | {
      status: "already-enrolled";
      offeringTitle: string;
      offeringType: "course" | "event";
    }
  | { status: "invalid" }
  | { status: "unauthenticated" };

export type AccessCodeRedemptionResult =
  | {
      status: "enrolled";
      offeringTitle: string;
      offeringType: "course" | "event";
    }
  | {
      status: "already-enrolled";
      offeringTitle: string;
      offeringType: "course" | "event";
    }
  | { status: "invalid" }
  | { status: "unauthenticated" };
