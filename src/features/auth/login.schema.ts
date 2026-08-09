import { z } from "#/validation/zod";

const safeInternalPathSchema = z.string().check(
  z.maxLength(500),
  z.refine(
    (value) => value.startsWith("/") && !value.startsWith("//"),
    "Redirect must stay within Upskill",
  ),
);

export const loginSearchSchema = z.object({
  redirect: z.catch(safeInternalPathSchema, "/dashboard"),
});

export const loginCredentialsSchema = z.object({
  email: z.pipe(
    z.string().check(z.trim(), z.minLength(1, "Enter your email address.")),
    z.email("Enter a valid email address."),
  ),
  password: z.string().check(z.minLength(1, "Enter your password.")),
});
