import "@tanstack/react-start/server-only";

import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  AWS_REGION: z.string().min(1).default("ap-southeast-2"),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  S3_QUARANTINE_BUCKET: z.string().min(3).default("upskill-quarantine"),
  S3_LEARNING_CONTENT_BUCKET: z
    .string()
    .min(3)
    .default("upskill-learning-content"),
  S3_PRIVATE_RESOURCES_BUCKET: z
    .string()
    .min(3)
    .default("upskill-private-resources"),
  S3_CERTIFICATES_BUCKET: z.string().min(3).default("upskill-certificates"),
});

export type ServerEnv = z.infer<typeof envSchema>;

let parsed: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  parsed ??= envSchema.parse(process.env);
  return parsed;
}
