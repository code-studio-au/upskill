import "@tanstack/react-start/server-only";

import { z } from "#/validation/zod.server";

const packageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export const adminScormUploadQuerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  packageId: packageIdSchema.optional(),
});

export const adminScormRemovalInputSchema = z.object({
  packageVersionId: packageIdSchema,
});
