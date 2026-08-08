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
});

export type ServerEnv = z.infer<typeof envSchema>;

let parsed: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  parsed ??= envSchema.parse(process.env);
  return parsed;
}
