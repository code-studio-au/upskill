import { createServerFn } from "@tanstack/react-start";
import {
  eventVirtualLobbyReferenceSchema,
  type EventVirtualLobbyOutcome,
  type EventVirtualLobbyPageData,
  type EventVirtualLobbyPageResult,
} from "#/features/event-lobby/event-virtual-lobby.schema";
import { formatLocalDateTime } from "#/features/shared/local-date";

function presentation(
  outcome: EventVirtualLobbyOutcome,
  recordingNotice: string | null,
): EventVirtualLobbyPageData["presentation"] {
  if (outcome === "authentication_required")
    return {
      title: "Verify your registration",
      message:
        "Sign in, or request a short-lived code using the verified email or mobile number on your Upskill profile.",
      tone: "blue",
    };
  if (outcome === "questionnaire_required")
    return {
      title: "Registration details required",
      message:
        "Complete the registration questions before entering this webinar waiting room.",
      tone: "orange",
    };
  if (outcome === "recording_acknowledgement_required")
    return {
      title: "Recording notice",
      message: recordingNotice ?? "Review the recording notice to continue.",
      tone: "blue",
    };
  const presentations = {
    meeting_not_started: [
      "The webinar has not started",
      "You are in the waiting room. This page will update when the presenter opens the webinar.",
      "blue",
    ],
    waiting_for_admission: [
      "Waiting for admission",
      "A presenter can see that you are waiting. Keep this page open and you will be admitted here.",
      "blue",
    ],
    ready_to_join: [
      "Ready to join",
      "You have been admitted. The webinar player will open here when media delivery is enabled.",
      "green",
    ],
    locked: [
      "The webinar doors are locked",
      "The presenter has temporarily stopped new joins. This page will update if the doors reopen.",
      "orange",
    ],
    ended: [
      "The webinar has ended",
      "This webinar is no longer accepting attendees.",
      "gray",
    ],
    declined: [
      "Admission was declined",
      "Contact the event organiser if you believe this is incorrect.",
      "red",
    ],
    revoked: [
      "Webinar access is unavailable",
      "Your registration or this join link is no longer eligible for this webinar.",
      "red",
    ],
    provider_unavailable: [
      "The webinar is temporarily unavailable",
      "You remain admitted. Keep this page open while the connection is restored.",
      "orange",
    ],
  } as const;
  const content = presentations[outcome];
  return { title: content[0], message: content[1], tone: content[2] };
}

export const getEventVirtualLobby = createServerFn({ method: "GET" })
  .validator(eventVirtualLobbyReferenceSchema)
  .handler(async ({ data }): Promise<EventVirtualLobbyPageResult> => {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders(
      new Headers({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      }),
    );
    const { getRequestUser } = await import("#/server/auth/session.server");
    const { resolveEventVirtualLobby } =
      await import("#/server/events/event-virtual-lobby.server");
    const result = await resolveEventVirtualLobby(
      data.publicReference,
      await getRequestUser(),
    );
    if (result.status === "not-found") return result;
    return {
      status: "ready",
      data: {
        ...result.data,
        startsAtLabel: formatLocalDateTime(result.data.startsAt, {
          timeZone: result.data.timezone,
        }),
        presentation: presentation(
          result.data.outcome,
          result.data.recording.notice,
        ),
      },
    };
  });
