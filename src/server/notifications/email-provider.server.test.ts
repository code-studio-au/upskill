import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: {
    APP_ENV: "test",
    EMAIL_PROVIDER: "local_capture",
    MAILGUN_API_BASE_URL: "https://api.mailgun.net",
    MAILGUN_API_KEY: "",
    MAILGUN_DOMAIN: "",
    MAILGUN_FROM: "",
  },
  execute: vi.fn(),
  insertInto: vi.fn(),
  values: vi.fn(),
  onConflict: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => mocks.environment,
}));

describe("email provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.environment = {
      APP_ENV: "test",
      EMAIL_PROVIDER: "local_capture",
      MAILGUN_API_BASE_URL: "https://api.mailgun.net",
      MAILGUN_API_KEY: "",
      MAILGUN_DOMAIN: "",
      MAILGUN_FROM: "",
    };
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.insertInto.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ onConflict: mocks.onConflict });
    mocks.onConflict.mockReturnValue({ execute: mocks.execute });
    mocks.execute.mockResolvedValue(undefined);
  });

  it("captures a deterministic, idempotent local delivery", async () => {
    const { getEmailProvider } = await import("./email-provider.server");
    const database = { insertInto: mocks.insertInto };
    const provider = getEmailProvider(database as never);
    expect(provider.id).toBe("local_capture");
    await expect(
      provider.send({
        notificationId: "notification_1",
        recipientEmail: "learner@example.com",
        subject: "Subject",
        textBody: "Body",
        htmlBody: "<p>Body</p>",
      }),
    ).resolves.toEqual({ messageId: "local:notification_1" });
    expect(mocks.insertInto).toHaveBeenCalledWith("email_delivery_capture");
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: "notification_1",
        recipientEmail: "learner@example.com",
      }),
    );
  });

  it("keeps recovery codes in the dedicated local security capture", async () => {
    const { sendEventPrerequisiteRecoveryEmail } =
      await import("./email-provider.server");
    const database = { insertInto: mocks.insertInto };
    await expect(
      sendEventPrerequisiteRecoveryEmail(database as never, {
        challengeId: "challenge_1",
        recipientEmail: "learner@example.com",
        subject: "Your access code",
        textBody: "123456",
        htmlBody: "<p>123456</p>",
      }),
    ).resolves.toEqual({ messageId: "local:challenge_1" });
    expect(mocks.insertInto).toHaveBeenCalledWith(
      "event_prerequisite_email_capture",
    );
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "challenge_1",
        recipientEmail: "learner@example.com",
      }),
    );
  });

  it("keeps contact-verification codes in their own local security capture", async () => {
    const { sendContactVerificationEmail } =
      await import("./email-provider.server");
    await expect(
      sendContactVerificationEmail({ insertInto: mocks.insertInto } as never, {
        challengeId: "onboarding_challenge_1",
        recipientEmail: "learner@example.com",
        subject: "Verify email",
        textBody: "123456",
        htmlBody: "<p>123456</p>",
      }),
    ).resolves.toEqual({ messageId: "local:onboarding_challenge_1" });
    expect(mocks.insertInto).toHaveBeenCalledWith(
      "contact_verification_email_capture",
    );
  });

  it("fails closed when Mailgun is selected without complete configuration", async () => {
    const { getEmailProvider } = await import("./email-provider.server");
    const database = { insertInto: mocks.insertInto };
    mocks.environment = {
      APP_ENV: "production",
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_BASE_URL: "https://api.mailgun.net",
      MAILGUN_API_KEY: "",
      MAILGUN_DOMAIN: "",
      MAILGUN_FROM: "",
    };
    expect(() => getEmailProvider(database as never)).toThrow(
      "EMAIL_PROVIDER_NOT_CONFIGURED",
    );
  });

  it("sends Mailgun multipart requests through the provider boundary", async () => {
    const { getEmailProvider } = await import("./email-provider.server");
    mocks.environment = {
      APP_ENV: "development",
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_BASE_URL: "https://api.eu.mailgun.net",
      MAILGUN_API_KEY: "sending-key",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "Upskill <no-reply@mg.example.com>",
    };
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "<message@example.com>" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = getEmailProvider({} as never);
    await expect(
      provider.send({
        notificationId: "notification_2",
        recipientEmail: "learner@example.com",
        subject: "Set up your account",
        textBody: "Follow the link",
        htmlBody: "<p>Follow the link</p>",
      }),
    ).resolves.toEqual({ messageId: "<message@example.com>" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.eu.mailgun.net/v3/mg.example.com/messages");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      Authorization: `Basic ${Buffer.from("api:sending-key").toString("base64")}`,
    });
    expect(request.body).toBeInstanceOf(FormData);
    const form = request.body as FormData;
    expect(form.get("from")).toBe("Upskill <no-reply@mg.example.com>");
    expect(form.get("to")).toBe("learner@example.com");
    expect(form.get("subject")).toBe("Set up your account");
    expect(form.get("text")).toBe("Follow the link");
    expect(form.get("html")).toBe("<p>Follow the link</p>");
  });

  it("does not expose Mailgun response bodies when delivery is rejected", async () => {
    const { getEmailProvider } = await import("./email-provider.server");
    mocks.environment = {
      APP_ENV: "development",
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_BASE_URL: "https://api.mailgun.net",
      MAILGUN_API_KEY: "sending-key",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "Upskill <no-reply@mg.example.com>",
    };
    mocks.fetch.mockResolvedValue(
      new Response("secret provider detail", { status: 401 }),
    );
    await expect(
      getEmailProvider({} as never).send({
        notificationId: "notification_3",
        recipientEmail: "learner@example.com",
        subject: "Subject",
        textBody: "Body",
        htmlBody: "<p>Body</p>",
      }),
    ).rejects.toThrow("EMAIL_PROVIDER_REJECTED");
  });

  it("classifies a Mailgun transport failure as an uncertain delivery", async () => {
    const { getEmailProvider, isAmbiguousEmailDeliveryError } =
      await import("./email-provider.server");
    mocks.environment = {
      APP_ENV: "development",
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_BASE_URL: "https://api.mailgun.net",
      MAILGUN_API_KEY: "sending-key",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "Upskill <no-reply@mg.example.com>",
    };
    mocks.fetch.mockRejectedValue(new TypeError("connection reset"));

    const result = getEmailProvider({} as never).send({
      notificationId: "notification_4",
      recipientEmail: "learner@example.com",
      subject: "Subject",
      textBody: "Body",
      htmlBody: "<p>Body</p>",
    });

    await expect(result).rejects.toThrow("EMAIL_PROVIDER_REQUEST_FAILED");
    await result.catch((error: unknown) => {
      expect(isAmbiguousEmailDeliveryError(error)).toBe(true);
    });
  });

  it.each([
    ["unreadable response", "not-json"],
    ["unexpected response", JSON.stringify({ message: "Queued" })],
  ])(
    "classifies a Mailgun %s after acceptance as an uncertain delivery",
    async (_description, body) => {
      const { getEmailProvider, isAmbiguousEmailDeliveryError } =
        await import("./email-provider.server");
      mocks.environment = {
        APP_ENV: "development",
        EMAIL_PROVIDER: "mailgun",
        MAILGUN_API_BASE_URL: "https://api.mailgun.net",
        MAILGUN_API_KEY: "sending-key",
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "Upskill <no-reply@mg.example.com>",
      };
      mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }));

      const result = getEmailProvider({} as never).send({
        notificationId: "notification_accepted_without_id",
        recipientEmail: "learner@example.com",
        subject: "Subject",
        textBody: "Body",
        htmlBody: "<p>Body</p>",
      });

      await expect(result).rejects.toThrow("EMAIL_PROVIDER_REQUEST_FAILED");
      await result.catch((error: unknown) => {
        expect(isAmbiguousEmailDeliveryError(error)).toBe(true);
      });
    },
  );
});
