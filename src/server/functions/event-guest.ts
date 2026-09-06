import { createServerFn } from "@tanstack/react-start";
import {
  eventGuestReferenceSchema,
  eventGuestSubmissionSchema,
  type EventGuestAccessResult,
  type EventGuestSubmissionResult,
} from "#/features/event-guest/event-guest.schema";

export const getPublicEventGuestAccess = createServerFn({ method: "GET" })
  .validator(eventGuestReferenceSchema)
  .handler(async ({ data }): Promise<EventGuestAccessResult> => {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders(
      new Headers({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      }),
    );
    const { findPublicEventGuestAccess } =
      await import("#/server/events/event-guest-access.server");
    return await findPublicEventGuestAccess(data.publicReference);
  });

export const submitPublicEventGuestAccess = createServerFn({ method: "POST" })
  .validator(eventGuestSubmissionSchema)
  .handler(async ({ data }): Promise<Response | EventGuestSubmissionResult> => {
    const { submitPublicEventGuestAccess: submit } =
      await import("#/server/events/event-guest-access.server");
    const result = await submit(data);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    });
    if (
      result.status === "ready" &&
      result.joinSessionToken &&
      result.joinSessionPublicReference
    ) {
      const { eventVirtualJoinSessionCookie } =
        await import("#/server/events/event-virtual-lobby.server");
      headers.set(
        "Set-Cookie",
        eventVirtualJoinSessionCookie(
          result.joinSessionToken,
          result.joinSessionPublicReference,
        ),
      );
      headers.set("Location", result.data.destinationUrl ?? "/");
      return new Response(null, { status: 204, headers });
    }
    return result.status === "ready"
      ? { status: "ready", data: result.data }
      : result;
  });
