import { z } from "#/validation/zod";

export const accountInvitationSchema = z.object({
  name: z
    .string()
    .check(
      z.trim(),
      z.minLength(2, "Enter the person's name."),
      z.maxLength(200),
    ),
  email: z.email("Enter a valid email address.").check(z.maxLength(320)),
});

export type AccountInvitationInput = z.infer<typeof accountInvitationSchema>;
