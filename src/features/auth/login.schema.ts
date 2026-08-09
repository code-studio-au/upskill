import { z } from "zod";

const safeInternalPathSchema = z
  .string()
  .max(500)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//"),
    "Redirect must stay within Upskill",
  );

export const loginSearchSchema = z.object({
  redirect: safeInternalPathSchema.catch("/dashboard"),
});
