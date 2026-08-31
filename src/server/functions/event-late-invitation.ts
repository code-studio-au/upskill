import { createServerFn } from "@tanstack/react-start";
import { eventLateInvitationInputSchema } from "#/features/learner/event-late-invitation.schema";

export const getEventLateInvitation = createServerFn({ method: "POST" })
  .validator(eventLateInvitationInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { findEventLateRegistrationInvitation } =
      await import("#/server/events/event-late-registration-invitation.server");
    return await findEventLateRegistrationInvitation(data.token, user);
  });

export const acceptEventLateInvitation = createServerFn({ method: "POST" })
  .validator(eventLateInvitationInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { acceptEventLateRegistrationInvitation } =
      await import("#/server/events/event-late-registration-invitation.server");
    return await acceptEventLateRegistrationInvitation(data.token, user);
  });
