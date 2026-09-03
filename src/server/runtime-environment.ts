import { z } from "#/validation/zod.server.ts";

const LOCAL_ACCESS_CODE_ENCRYPTION_KEY =
  "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE";

const environmentSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  LEARNING_ORIGIN: z.url().default("http://localhost:3001"),
  SUPPORT_EMAIL: z.email().default("support@upskill.example"),
  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ACCESS_CODE_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/u)
    .default(LOCAL_ACCESS_CODE_ENCRYPTION_KEY),
  STRIPE_SECRET_KEY: z.string().regex(/^(?:sk|rk)_/u, {
    message: "Stripe secret key must start with sk_ or rk_",
  }),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  EMAIL_PROVIDER: z.enum(["local_capture", "mailgun"]).default("local_capture"),
  MAILGUN_API_KEY: z.string().min(1).optional(),
  MAILGUN_DOMAIN: z.string().min(1).optional(),
  MAILGUN_FROM: z.string().min(1).max(320).optional(),
  MAILGUN_API_BASE_URL: z.url().default("https://api.mailgun.net"),
  SMS_PROVIDER: z.enum(["local_capture", "textbee"]).default("local_capture"),
  TEXTBEE_API_KEY: z.string().min(1).optional(),
  TEXTBEE_API_BASE_URL: z.url().default("https://api.textbee.dev"),
  TEXTBEE_DEVICE_ID: z.string().min(1).optional(),
  TEXTBEE_WEBHOOK_SECRET: z.string().min(20).optional(),
  LIVEKIT_ENABLED: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  LIVEKIT_PROJECT_ENVIRONMENT: z
    .enum(["development", "test", "staging", "production"])
    .optional(),
  LIVEKIT_URL: z.url().optional(),
  LIVEKIT_API_KEY: z.string().min(1).max(200).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).max(500).optional(),
  LIVEKIT_APPROVED_MAX_PARTICIPANTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional(),
  LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional(),
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

export type ServerEnv = z.infer<typeof environmentSchema>;

function requireLiveKitConfiguration(validated: ServerEnv): void {
  if (!validated.LIVEKIT_ENABLED) return;
  if (!validated.LIVEKIT_PROJECT_ENVIRONMENT)
    throw new Error(
      "LIVEKIT_PROJECT_ENVIRONMENT is required when LiveKit is enabled",
    );
  if (validated.LIVEKIT_PROJECT_ENVIRONMENT !== validated.APP_ENV)
    throw new Error(
      "LIVEKIT_PROJECT_ENVIRONMENT must match APP_ENV when LiveKit is enabled",
    );
  if (!validated.LIVEKIT_URL)
    throw new Error("LIVEKIT_URL is required when LiveKit is enabled");
  if (!validated.LIVEKIT_API_KEY)
    throw new Error("LIVEKIT_API_KEY is required when LiveKit is enabled");
  if (!validated.LIVEKIT_API_SECRET)
    throw new Error("LIVEKIT_API_SECRET is required when LiveKit is enabled");
  if (validated.LIVEKIT_API_SECRET.length < 32)
    throw new Error(
      "LIVEKIT_API_SECRET must contain at least 32 characters when LiveKit is enabled",
    );
  if (!validated.LIVEKIT_APPROVED_MAX_PARTICIPANTS)
    throw new Error(
      "LIVEKIT_APPROVED_MAX_PARTICIPANTS is required when LiveKit is enabled",
    );
  if (!validated.LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS)
    throw new Error(
      "LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS is required when LiveKit is enabled",
    );

  const url = new URL(validated.LIVEKIT_URL);
  const localEnvironment =
    validated.APP_ENV === "development" || validated.APP_ENV === "test";
  if (url.protocol !== "wss:" && !(localEnvironment && url.protocol === "ws:"))
    throw new Error(
      "LIVEKIT_URL must use WSS outside local environments and WS or WSS locally",
    );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("LIVEKIT_URL must be a canonical WebSocket origin");
  if (
    !localEnvironment &&
    (/replace|\.invalid$|\.example$/iu.test(url.hostname) ||
      /replace/iu.test(validated.LIVEKIT_API_KEY) ||
      /replace/iu.test(validated.LIVEKIT_API_SECRET))
  )
    throw new Error(
      "LiveKit credentials and URL must be configured outside local environments",
    );
}

function requireCanonicalHttpsOrigin(label: string, value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error(`${label} must use HTTPS outside local environments`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} must be a canonical HTTPS origin`);
  if (/replace|\.invalid$|\.example$/iu.test(url.hostname))
    throw new Error(`${label} must be configured outside local environments`);
  return url;
}

export function parseServerEnvironment(
  environment: NodeJS.ProcessEnv,
): ServerEnv {
  const validated = environmentSchema.parse(environment);
  requireLiveKitConfiguration(validated);
  if (validated.EMAIL_PROVIDER === "mailgun") {
    if (!validated.MAILGUN_API_KEY)
      throw new Error("MAILGUN_API_KEY is required for Mailgun delivery");
    if (!validated.MAILGUN_DOMAIN)
      throw new Error("MAILGUN_DOMAIN is required for Mailgun delivery");
    if (!validated.MAILGUN_FROM)
      throw new Error("MAILGUN_FROM is required for Mailgun delivery");
  }
  if (validated.SMS_PROVIDER === "textbee") {
    if (!validated.TEXTBEE_API_KEY)
      throw new Error("TEXTBEE_API_KEY is required for TextBee delivery");
    if (!validated.TEXTBEE_WEBHOOK_SECRET)
      throw new Error(
        "TEXTBEE_WEBHOOK_SECRET is required for TextBee delivery tracking",
      );
  }
  if (validated.APP_ENV === "staging" || validated.APP_ENV === "production") {
    const applicationOrigin = requireCanonicalHttpsOrigin(
      "APP_ORIGIN",
      validated.APP_ORIGIN,
    );
    const learningOrigin = requireCanonicalHttpsOrigin(
      "LEARNING_ORIGIN",
      validated.LEARNING_ORIGIN,
    );
    if (applicationOrigin.origin === learningOrigin.origin)
      throw new Error("APP_ORIGIN and LEARNING_ORIGIN must be distinct");
    if (
      !environment.ACCESS_CODE_ENCRYPTION_KEY ||
      validated.ACCESS_CODE_ENCRYPTION_KEY === LOCAL_ACCESS_CODE_ENCRYPTION_KEY
    )
      throw new Error(
        "A non-local ACCESS_CODE_ENCRYPTION_KEY is required outside local environments",
      );
    for (const key of [
      "AWS_REGION",
      "S3_QUARANTINE_BUCKET",
      "S3_LEARNING_CONTENT_BUCKET",
      "S3_PRIVATE_RESOURCES_BUCKET",
      "SQS_QUEUE_URL",
      "SQS_DEAD_LETTER_QUEUE_URL",
      "SUPPORT_EMAIL",
      "LIVEKIT_PROJECT_ENVIRONMENT",
    ] as const)
      if (!environment[key])
        throw new Error(`${key} is required outside local environments`);
    if (!environment.LIVEKIT_ENABLED)
      throw new Error(
        "LIVEKIT_ENABLED must be explicitly configured outside local environments",
      );
    for (const key of [
      "S3_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SQS_ENDPOINT",
    ] as const)
      if (environment[key])
        throw new Error(`${key} is prohibited outside local environments`);
    if (validated.S3_FORCE_PATH_STYLE)
      throw new Error(
        "S3_FORCE_PATH_STYLE must be false outside local environments",
      );
    if (validated.EMAIL_PROVIDER !== "mailgun")
      throw new Error(
        "Mailgun delivery is required outside local environments",
      );
    if (validated.SMS_PROVIDER !== "textbee")
      throw new Error(
        "TextBee delivery is required outside local environments",
      );
    for (const [key, value] of [
      ["SUPPORT_EMAIL", validated.SUPPORT_EMAIL],
      ["STRIPE_SECRET_KEY", validated.STRIPE_SECRET_KEY],
      ["STRIPE_WEBHOOK_SECRET", validated.STRIPE_WEBHOOK_SECRET],
      ["MAILGUN_API_KEY", validated.MAILGUN_API_KEY],
      ["MAILGUN_DOMAIN", validated.MAILGUN_DOMAIN],
      ["MAILGUN_FROM", validated.MAILGUN_FROM],
      ["TEXTBEE_API_KEY", validated.TEXTBEE_API_KEY],
      ["TEXTBEE_WEBHOOK_SECRET", validated.TEXTBEE_WEBHOOK_SECRET],
    ] as const)
      if (!value || /replace|\.invalid|\.example(?:$|>)/iu.test(value))
        throw new Error(`${key} must be configured outside local environments`);
    return validated;
  }
  return {
    ...validated,
    SQS_ENDPOINT: validated.SQS_ENDPOINT ?? "http://127.0.0.1:9324",
  };
}
