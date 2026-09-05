import { createServerFn } from "@tanstack/react-start";
import {
  eventVirtualLobbyReferenceSchema,
  type EventVirtualLobbyResult,
} from "#/features/event-lobby/event-virtual-lobby.schema";

export const getEventVirtualLobby = createServerFn({ method: "GET" })
  .validator(eventVirtualLobbyReferenceSchema)
  .handler(async ({ data }): Promise<EventVirtualLobbyResult> => {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders(
      new Headers({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      }),
    );
    const { getRequestUser } = await import("#/server/auth/session.server");
    const { resolveEventVirtualLobby } =
      await import("#/server/events/event-virtual-lobby.server");
    return await resolveEventVirtualLobby(
      data.publicReference,
      await getRequestUser(),
    );
  });
