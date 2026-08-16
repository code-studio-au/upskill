import "@tanstack/react-start/server-only";

import { z } from "#/validation/zod.server";

const LOCAL_ACCESS_CODE_ENCRYPTION_KEY =
  "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE";

const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  LEARNING_ORIGIN: z.url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  ACCESS_CODE_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/u)
    .default(LOCAL_ACCESS_CODE_ENCRYPTION_KEY),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  EMAIL_PROVIDER: z.enum(["local_capture", "mailgun"]).default("local_capture"),
  MAILGUN_API_KEY: z.string().min(1).optional(),
  MAILGUN_DOMAIN: z.string().min(1).optional(),
  MAILGUN_FROM: z.string().min(1).max(320).optional(),
  MAILGUN_API_BASE_URL: z.url().default("https://api.mailgun.net"),
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
  SQS_ENDPOINT: z.url().optional(),
  SQS_QUEUE_URL: z
    .url()
    .default("http://127.0.0.1:9324/000000000000/upskill-work"),
  SQS_DEAD_LETTER_QUEUE_URL: z
    .url()
    .default("http://127.0.0.1:9324/000000000000/upskill-work-dlq"),
  SQS_RECEIVE_WAIT_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(43_200)
    .default(900),
});

export type ServerEnv = z.infer<typeof envSchema>;

let parsed: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (parsed) return parsed;
  const validated = envSchema.parse(process.env);
  if (validated.EMAIL_PROVIDER === "mailgun") {
    if (!validated.MAILGUN_API_KEY)
      throw new Error("MAILGUN_API_KEY is required for Mailgun delivery");
    if (!validated.MAILGUN_DOMAIN)
      throw new Error("MAILGUN_DOMAIN is required for Mailgun delivery");
    if (!validated.MAILGUN_FROM)
      throw new Error("MAILGUN_FROM is required for Mailgun delivery");
  }
  if (validated.APP_ENV === "staging" || validated.APP_ENV === "production") {
    if (
      !process.env.ACCESS_CODE_ENCRYPTION_KEY ||
      validated.ACCESS_CODE_ENCRYPTION_KEY === LOCAL_ACCESS_CODE_ENCRYPTION_KEY
    )
      throw new Error(
        "A non-local ACCESS_CODE_ENCRYPTION_KEY is required outside local environments",
      );
    if (!process.env.SQS_QUEUE_URL)
      throw new Error("SQS_QUEUE_URL is required outside local environments");
    if (validated.SQS_ENDPOINT)
      throw new Error("SQS_ENDPOINT is prohibited outside local environments");
    if (validated.EMAIL_PROVIDER !== "mailgun")
      throw new Error(
        "Mailgun delivery is required outside local environments",
      );
    parsed = validated;
  } else {
    parsed = {
      ...validated,
      SQS_ENDPOINT: validated.SQS_ENDPOINT ?? "http://127.0.0.1:9324",
    };
  }
  return parsed;
}
