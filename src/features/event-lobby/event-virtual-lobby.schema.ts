import { z } from "#/validation/zod";

export const eventVirtualLobbyReferenceSchema = z.object({
  publicReference: z.string().check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/u)),
});

export type EventVirtualLobbyOutcome =
  | "authentication_required"
  | "questionnaire_required"
  | "meeting_not_started"
  | "waiting_for_admission"
  | "recording_acknowledgement_required"
  | "ready_to_join"
  | "locked"
  | "ended"
  | "declined"
  | "revoked"
  | "provider_unavailable";

interface EventVirtualLobbyData {
  eventTitle: string;
  sessionTitle: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  outcome: EventVirtualLobbyOutcome;
  admissionState:
    | "not_requested"
    | "waiting"
    | "admitted"
    | "token_issued"
    | "connected"
    | "left"
    | "declined"
    | "revoked";
  accessMethod: "authenticated" | "email" | "sms" | null;
  eventOccurrenceId: string | null;
  questionnaireUrl: string | null;
  recording: {
    enabled: boolean;
    notice: string | null;
    acknowledged: boolean;
  };
  pollAfterMilliseconds: number | null;
}

export type EventVirtualLobbyResult =
  { status: "ready"; data: EventVirtualLobbyData } | { status: "not-found" };

export interface EventVirtualLobbyPageData extends EventVirtualLobbyData {
  startsAtLabel: string;
  presentation: {
    title: string;
    message: string;
    tone: "blue" | "green" | "orange" | "gray" | "red";
  };
}

export type EventVirtualLobbyPageResult =
  | { status: "ready"; data: EventVirtualLobbyPageData }
  | { status: "not-found" };

export type EventVirtualRecoveryRequestResult =
  | { status: "accepted"; challengeReference: string }
  | { status: "rate-limited" }
  | { status: "unavailable" };

export type EventVirtualRecoveryVerificationResult =
  | { status: "ready"; joinSessionToken?: string }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "rate-limited" };

export type EventVirtualAttendeeCredentialResult =
  | {
      status: "ready";
      credential: {
        token: string;
        websocketUrl: string;
        expiresAt: string;
        generation: number;
      };
    }
  | { status: "unauthenticated" }
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "questionnaire_required"
        | "meeting_not_started"
        | "waiting_for_admission"
        | "recording_acknowledgement_required"
        | "locked"
        | "ended"
        | "revoked"
        | "provider_unavailable";
    };

export type EventVirtualLobbyMutationResult =
  | { status: "ready" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | {
      status: "conflict";
      reason: "invalid_transition" | "ineligible" | "session_ended";
    };
