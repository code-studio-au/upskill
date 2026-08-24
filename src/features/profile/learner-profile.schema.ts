import { z } from "#/validation/zod";
import { normalizeInternationalPhone } from "./phone-number";

export const learnerProfileUpdateSchema = z
  .object({
    name: z.string().check(z.trim(), z.minLength(1), z.maxLength(160)),
    phone: z.string().check(z.trim(), z.maxLength(40)),
    currentRegionId: z.string().check(z.trim(), z.maxLength(255)),
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
  })
  .check(
    z.superRefine((value, context) => {
      if (value.phone !== "" && !normalizeInternationalPhone(value.phone))
        context.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Enter an international mobile number.",
        });
      if (value.smsEnabled && value.phone === "")
        context.addIssue({
          code: "custom",
          path: ["smsEnabled"],
          message: "Add a mobile number before enabling SMS.",
        });
    }),
  );

export const profileVerificationRequestSchema = z.object({
  channel: z.enum(["email", "sms"]),
});

export const profileVerificationCodeSchema = z.object({
  channel: z.enum(["email", "sms"]),
  code: z.string().check(z.trim(), z.regex(/^\d{6}$/u)),
});

interface LearnerProfileRegion {
  id: string;
  name: string;
  groupName: string | null;
  active: boolean;
}

export interface LearnerProfile {
  name: string;
  email: string;
  emailEnabled: boolean;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  phone: string | null;
  smsEnabled: boolean;
  smsVerifiedAt: string | null;
  currentRegionId: string | null;
  regions: Array<LearnerProfileRegion>;
}

export type LearnerProfileResult =
  { status: "ready"; data: LearnerProfile } | { status: "unauthenticated" };

export type LearnerProfileUpdateResult =
  { status: "updated" } | { status: "invalid" | "unavailable" };
