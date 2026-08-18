import { z } from "#/validation/zod";

export const EVENT_GUEST_PRIVACY_NOTICE_VERSION = "2026-08-17";

export const eventGuestReferenceSchema = z.object({
  publicReference: z
    .string()
    .check(z.regex(/^[A-Za-z0-9_-]{32}$/), z.maxLength(32)),
});

export const eventGuestSubmissionSchema = z.object({
  publicReference: eventGuestReferenceSchema.shape.publicReference,
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
  email: z.email().check(z.maxLength(320)),
  privacyAccepted: z
    .boolean()
    .check(
      z.refine((value) => value, "Accept the privacy notice to continue."),
    ),
});

export type EventGuestAccessResult =
  | { status: "not-found" }
  | {
      status: "unavailable";
      reason: "not-open" | "closed" | "cancelled";
      title: string;
    }
  | {
      status: "ready";
      data: {
        title: string;
        deliveryMode: "in_person" | "virtual";
        startsAt: string;
        endsAt: string;
        timezone: string;
      };
    };

export type EventGuestSubmissionResult =
  | { status: "not-found" | "rate-limited" }
  | {
      status: "unavailable";
      reason: "not-open" | "closed" | "cancelled";
    }
  | {
      status: "ready";
      data: {
        eventOccurrenceId: string;
        eventTitle: string;
        deliveryMode: "in_person" | "virtual";
        destinationUrl: string | null;
        venueName: string | null;
        venueAddress: string | null;
        attendanceState: "not_recorded" | "checked_in" | "attended";
        accountSetupRequested: boolean;
      };
    };
