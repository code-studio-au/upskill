import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appEnvironment: "test",
  execute: vi.fn(),
  insertInto: vi.fn(),
  values: vi.fn(),
  onConflict: vi.fn(),
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => ({ APP_ENV: mocks.appEnvironment }),
}));

describe("email provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnvironment = "test";
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

  it("supports development but fails closed without a production provider", async () => {
    const { getEmailProvider } = await import("./email-provider.server");
    const database = { insertInto: mocks.insertInto };
    mocks.appEnvironment = "development";
    expect(getEmailProvider(database as never).id).toBe("local_capture");
    mocks.appEnvironment = "production";
    expect(() => getEmailProvider(database as never)).toThrow(
      "EMAIL_PROVIDER_NOT_CONFIGURED",
    );
  });
});
