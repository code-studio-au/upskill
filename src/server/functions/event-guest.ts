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
  .handler(async ({ data }): Promise<EventGuestSubmissionResult> => {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders(
      new Headers({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      }),
    );
    const { submitPublicEventGuestAccess: submit } =
      await import("#/server/events/event-guest-access.server");
    return await submit(data);
  });
