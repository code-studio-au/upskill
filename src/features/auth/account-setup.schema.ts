import { z } from "#/validation/zod";

export const accountSetupTokenSchema = z
  .string()
  .check(z.length(43), z.regex(/^[A-Za-z0-9_-]+$/u));

export const accountSetupPasswordSchema = z
  .object({
    password: z
      .string()
      .check(
        z.minLength(12, "Use at least 12 characters."),
        z.maxLength(128, "Use no more than 128 characters."),
      ),
    confirmPassword: z.string(),
  })
  .check(
    z.superRefine((value, context) => {
      if (value.password !== value.confirmPassword)
        context.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Passwords do not match.",
        });
    }),
  );

export const accountSetupInputSchema = z.object({
  token: accountSetupTokenSchema,
});

export const accountSetupContinuePathSchema = z
  .string()
  .check(
    z.maxLength(500),
    z.regex(/^\/(?:courses|events)\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/u),
  );
