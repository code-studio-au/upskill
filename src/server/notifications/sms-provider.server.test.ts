import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: {
    SMS_PROVIDER: "local_capture",
    TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
    TEXTBEE_API_KEY: "",
    TEXTBEE_DEVICE_ID: undefined as string | undefined,
    TEXTBEE_WEBHOOK_SECRET: undefined as string | undefined,
  },
  execute: vi.fn(),
  fetch: vi.fn(),
  insertInto: vi.fn(),
  onConflict: vi.fn(),
  set: vi.fn(),
  updateTable: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => mocks.environment,
}));

describe("SMS provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.environment = {
      SMS_PROVIDER: "local_capture",
      TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
      TEXTBEE_API_KEY: "",
      TEXTBEE_DEVICE_ID: undefined,
      TEXTBEE_WEBHOOK_SECRET: undefined,
    };
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.insertInto.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({
      execute: mocks.execute,
      onConflict: mocks.onConflict,
    });
    mocks.onConflict.mockReturnValue({ execute: mocks.execute });
    mocks.updateTable.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ execute: mocks.execute });
    mocks.execute.mockResolvedValue(undefined);
  });

  it("captures local security SMS without logging or queueing it", async () => {
    const { sendEventPrerequisiteRecoverySms } =
      await import("./sms-provider.server");
    await expect(
      sendEventPrerequisiteRecoverySms(
        {
          insertInto: mocks.insertInto,
          updateTable: mocks.updateTable,
        } as never,
        {
          deliveryId: "challenge_1",
          recipientUserId: "user_1",
          recipientName: "Learner One",
          recipientPhone: "+61400000000",
          message: "Your code is 123456.",
        },
      ),
    ).resolves.toEqual({ messageId: "local:challenge_1" });
    expect(mocks.insertInto).toHaveBeenCalledWith(
      "event_prerequisite_sms_capture",
    );
    expect(mocks.insertInto).toHaveBeenCalledWith("sms_delivery");
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "challenge_1",
        recipientPhone: "+61400000000",
      }),
    );
  });

  it("captures onboarding SMS in its dedicated security table", async () => {
    const { sendOnboardingVerificationSms } =
      await import("./sms-provider.server");
    await expect(
      sendOnboardingVerificationSms(
        {
          insertInto: mocks.insertInto,
          updateTable: mocks.updateTable,
        } as never,
        {
          deliveryId: "onboarding_challenge_1",
          recipientUserId: "user_1",
          recipientName: "Learner One",
          recipientPhone: "+61400000000",
          message: "Your verification code is 123456.",
        },
      ),
    ).resolves.toEqual({ messageId: "local:onboarding_challenge_1" });
    expect(mocks.insertInto).toHaveBeenCalledWith(
      "onboarding_sms_verification_capture",
    );
  });

  it("sends the documented TextBee request and accepts a queued batch", async () => {
    const { getSmsProvider } = await import("./sms-provider.server");
    mocks.environment = {
      SMS_PROVIDER: "textbee",
      TEXTBEE_API_BASE_URL: "https://api.textbee.dev/",
      TEXTBEE_API_KEY: "secret-key",
      TEXTBEE_DEVICE_ID: "device_1",
      TEXTBEE_WEBHOOK_SECRET: "webhook-signing-secret",
    };
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { success: true, smsBatchId: "batch_1", recipientCount: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      getSmsProvider({} as never).send({
        deliveryId: "challenge_2",
        recipientUserId: "user_2",
        recipientName: "Learner Two",
        recipientPhone: "+61400000001",
        message: "Your code is 654321.",
      }),
    ).resolves.toEqual({ messageId: "batch_1" });
    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.textbee.dev/api/v1/gateway/send-sms");
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "secret-key",
    });
    expect(request.body).toBe(
      JSON.stringify({
        recipients: ["+61400000001"],
        message: "Your code is 654321.",
        deviceId: "device_1",
      }),
    );
  });

  it("accepts immediate dispatch and fails closed on provider failures", async () => {
    const { getSmsProvider } = await import("./sms-provider.server");
    mocks.environment = {
      SMS_PROVIDER: "textbee",
      TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
      TEXTBEE_API_KEY: "secret-key",
      TEXTBEE_DEVICE_ID: undefined,
      TEXTBEE_WEBHOOK_SECRET: "webhook-signing-secret",
    };
    const provider = getSmsProvider({} as never);
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { successCount: 1, failureCount: 0 } }),
        {
          status: 200,
        },
      ),
    );
    await expect(
      provider.send({
        deliveryId: "challenge_3",
        recipientUserId: "user_3",
        recipientName: "Learner Three",
        recipientPhone: "+61400000002",
        message: "Code",
      }),
    ).rejects.toThrow("SMS_PROVIDER_INVALID_RESPONSE");
    mocks.fetch.mockResolvedValueOnce(
      new Response("private provider detail", { status: 429 }),
    );
    await expect(
      provider.send({
        deliveryId: "challenge_4",
        recipientUserId: "user_4",
        recipientName: "Learner Four",
        recipientPhone: "+61400000002",
        message: "Code",
      }),
    ).rejects.toThrow("SMS_PROVIDER_REJECTED");
  });

  it("records a transport failure as unknown because TextBee may have accepted it", async () => {
    const { isAmbiguousSmsDeliveryError, sendOnboardingVerificationSms } =
      await import("./sms-provider.server");
    mocks.environment = {
      SMS_PROVIDER: "textbee",
      TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
      TEXTBEE_API_KEY: "secret-key",
      TEXTBEE_DEVICE_ID: "device_1",
      TEXTBEE_WEBHOOK_SECRET: "webhook-signing-secret",
    };
    mocks.fetch.mockRejectedValue(new TypeError("connection reset"));

    const result = sendOnboardingVerificationSms(
      {
        insertInto: mocks.insertInto,
        updateTable: mocks.updateTable,
      } as never,
      {
        deliveryId: "challenge_5",
        recipientUserId: "user_5",
        recipientName: "Learner Five",
        recipientPhone: "+61400000005",
        message: "Your verification code is 123456.",
      },
    );

    await expect(result).rejects.toThrow("SMS_PROVIDER_REQUEST_FAILED");
    await result.catch((error: unknown) => {
      expect(isAmbiguousSmsDeliveryError(error)).toBe(true);
    });
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        lastErrorCode: "sms_provider_request_failed",
        failedAt: null,
      }),
    );
  });
});
