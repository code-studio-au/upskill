import { z } from "#/validation/zod";

export const eventLateInvitationTokenSchema = z
  .string()
  .check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/u));

export const eventLateInvitationInputSchema = z.object({
  token: eventLateInvitationTokenSchema,
});
