import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults = new Map<string, Array<unknown>>();
  const inserts: Array<{ table: string; values: unknown }> = [];
  const updates: Array<{ table: string; values: unknown }> = [];
  const deletes: Array<string> = [];

  function nextResult(table: string): unknown {
    return selectResults.get(table)?.shift();
  }

  function query(table: string) {
    const builder = {
      innerJoin: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      select: vi.fn(() => builder),
      where: vi.fn(() => builder),
      forUpdate: vi.fn(() => builder),
      set: vi.fn((values: unknown) => {
        updates.push({ table, values });
        return builder;
      }),
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        return builder;
      }),
      execute: vi.fn(() => Promise.resolve([])),
      executeTakeFirst: vi.fn(() => Promise.resolve(nextResult(table))),
      executeTakeFirstOrThrow: vi.fn(() => {
        const result = nextResult(table);
        if (!result)
          return Promise.reject(new Error(`Missing result for ${table}`));
        return Promise.resolve(result);
      }),
    };
    return builder;
  }

  const database = {
    selectFrom: vi.fn((table: string) => query(table)),
    updateTable: vi.fn((table: string) => query(table)),
    insertInto: vi.fn((table: string) => query(table)),
    deleteFrom: vi.fn((table: string) => {
      deletes.push(table);
      return query(table);
    }),
    transaction: vi.fn(() => ({
      execute: async (callback: (database: unknown) => Promise<unknown>) =>
        await callback(database),
    })),
  };

  return {
    audit: vi.fn(),
    database,
    deletes,
    environment: {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
    },
    headers: new Headers(),
    inserts,
    log: vi.fn(),
    resolveSurvey: vi.fn(),
    selectResults,
    sendEmail:
      vi.fn<
        (
          database: unknown,
          message: { recipientEmail: string; textBody: string },
        ) => Promise<{ messageId: string }>
      >(),
    sendSms:
      vi.fn<
        (
          database: unknown,
          message: { recipientPhone: string; message: string },
        ) => Promise<{ messageId: string }>
      >(),
    updates,
  };
});

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => mocks.headers,
}));
vi.mock("#/server/db/database.server", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("#/server/env.server", () => ({
  getServerEnv: () => mocks.environment,
}));
vi.mock("#/server/audit/audit-event.server", () => ({
  recordDurableAuditEvent: mocks.audit,
}));
vi.mock("#/server/logging/server-logger", () => ({
  logServerEvent: mocks.log,
}));
vi.mock("#/server/notifications/email-provider.server", () => ({
  sendEventPrerequisiteRecoveryEmail: mocks.sendEmail,
}));
vi.mock("#/server/notifications/sms-provider.server", () => ({
  sendEventPrerequisiteRecoverySms: mocks.sendSms,
}));
vi.mock("./event-survey-access.server", () => ({
  resolveLearnerEventSurveyReference: mocks.resolveSurvey,
}));

const destination = {
  eventSurveyAccessId: "survey_access_1",
  eventOccurrenceId: "occurrence_1",
  eventTemplateVersionItemId: "item_1",
  eventTitle: "Secure Event",
  occurrenceStatus: "published",
  occurrencePublishedAt: new Date("2026-08-20T00:00:00Z"),
  sectionTitle: "Before the event",
  surveyTitle: "Readiness survey",
  activityPublishedAt: new Date("2026-08-20T00:00:00Z"),
};

describe("event prerequisite recovery boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.clear();
    mocks.inserts.length = 0;
    mocks.updates.length = 0;
    mocks.deletes.length = 0;
    mocks.headers = new Headers({ "x-real-ip": "192.0.2.10" });
    mocks.environment.APP_ENV = "test";
    mocks.sendEmail.mockResolvedValue({ messageId: "local:challenge" });
    mocks.sendSms.mockResolvedValue({ messageId: "local:challenge" });
  });

  it("returns the same accepted shape for an unknown participant", async () => {
    mocks.selectResults.set("event_survey_access as access", [destination]);
    mocks.selectResults.set("event_participation as participation", [
      undefined,
    ]);
    const { requestEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    const result = await requestEventRecoveryCode({
      publicReference: "A234567890_bcdefghijklmnopqrstuv",
      identifier: "unknown@example.com",
    });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("Expected acceptance");
    expect(result.challengeReference).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });

  it("stores only digests and sends a code directly to an eligible participant", async () => {
    mocks.selectResults.set("event_survey_access as access", [destination]);
    mocks.selectResults.set("event_participation as participation", [
      {
        eventParticipationId: "participation_1",
        userId: "user_1",
        email: "Learner@Example.com",
      },
    ]);
    mocks.selectResults.set("event_prerequisite_recovery_challenge", [
      { count: "0" },
    ]);
    const { requestEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    const result = await requestEventRecoveryCode({
      publicReference: "B234567890_bcdefghijklmnopqrstuv",
      identifier: "learner@example.com",
    });
    expect(result.status).toBe("accepted");
    const inserted = mocks.inserts.find(
      (entry) => entry.table === "event_prerequisite_recovery_challenge",
    )?.values as Record<string, unknown>;
    expect(inserted).toMatchObject({
      eventSurveyAccessId: "survey_access_1",
      eventParticipationId: "participation_1",
      userId: "user_1",
      attempts: 0,
    });
    expect(inserted.identifierDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(inserted.requestFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(inserted.codeDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(inserted)).not.toContain("learner@example.com");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    const delivery = mocks.sendEmail.mock.calls[0]?.[1];
    expect(delivery?.recipientEmail).toBe("learner@example.com");
    expect(delivery?.textBody).toMatch(/\b\d{6}\b/u);
  });

  it("normalizes a matched mobile and sends the code through SMS", async () => {
    mocks.selectResults.set("event_survey_access as access", [destination]);
    mocks.selectResults.set("event_participation as participation", [
      {
        eventParticipationId: "participation_1",
        userId: "user_1",
        email: "learner@example.com",
      },
    ]);
    mocks.selectResults.set("event_prerequisite_recovery_challenge", [
      { count: "0" },
    ]);
    const { requestEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      requestEventRecoveryCode({
        publicReference: "Q234567890_bcdefghijklmnopqrstuv",
        identifier: "+61 400 000 000",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(mocks.inserts.at(-1)?.values).toEqual(
      expect.objectContaining({ deliveryChannel: "sms" }),
    );
    expect(mocks.sendSms).toHaveBeenCalledOnce();
    const sms = mocks.sendSms.mock.calls[0]?.[1];
    expect(sms?.recipientPhone).toBe("+61400000000");
    expect(sms?.message).toMatch(/\b\d{6}\b/u);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("consumes a valid code into one exact, short-lived task session", async () => {
    const now = Date.now();
    const challengeId = "challenge_1";
    const code = "123456";
    const { createHmac } = await import("node:crypto");
    const codeDigest = createHmac(
      "sha256",
      "test-secret-with-at-least-thirty-two-characters",
    )
      .update(`code:${challengeId}:${code}`)
      .digest("base64url");
    mocks.selectResults.set(
      "event_prerequisite_recovery_challenge as challenge",
      [
        {
          id: challengeId,
          eventSurveyAccessId: "survey_access_1",
          eventParticipationId: "participation_1",
          userId: "user_1",
          codeDigest,
          deliveryChannel: "email",
          attempts: 0,
          expiresAt: new Date(now + 60_000),
          consumedAt: null,
          eventOccurrenceId: "occurrence_1",
          eventTemplateVersionItemId: "item_1",
          accessRevokedAt: null,
          occurrenceStatus: "published",
        },
      ],
    );
    const { verifyEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    const result = await verifyEventRecoveryCode({
      publicReference: "C234567890_bcdefghijklmnopqrstuv",
      challengeReference: "D234567890_bcdefghijklmnopqrstuv",
      code,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected task session");
    expect(result.taskSessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.data).toEqual({
      eventOccurrenceId: "occurrence_1",
      eventTemplateVersionItemId: "item_1",
    });
    const task = mocks.inserts.find(
      (entry) => entry.table === "event_prerequisite_task_session",
    )?.values as Record<string, unknown>;
    expect(task).toMatchObject({
      challengeId,
      eventSurveyAccessId: "survey_access_1",
      eventParticipationId: "participation_1",
      userId: "user_1",
    });
    expect(task.tokenDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({
        action: "event_prerequisite.recovery_verified",
        actorUserId: "user_1",
        aggregateId: "occurrence_1",
      }),
    );
  });

  it("presents a neutral recovery landing without participant data", async () => {
    mocks.selectResults.set("event_survey_access as access", [destination]);
    const { resolveEventRecoveryLanding } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      resolveEventRecoveryLanding("E234567890_bcdefghijklmnopqrstuv", null),
    ).resolves.toEqual({
      status: "recovery-required",
      data: {
        eventTitle: "Secure Event",
        sectionTitle: "Before the event",
        surveyTitle: "Readiness survey",
      },
    });
  });

  it("rejects unavailable destinations before collecting an identifier", async () => {
    mocks.selectResults.set("event_survey_access as access", [
      undefined,
      { ...destination, occurrenceStatus: "draft" },
    ]);
    const { requestEventRecoveryCode, resolveEventRecoveryLanding } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      requestEventRecoveryCode({
        publicReference: "F234567890_bcdefghijklmnopqrstuv",
        identifier: "learner@example.com",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      resolveEventRecoveryLanding("G234567890_bcdefghijklmnopqrstuv", null),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("bounds repeated recovery requests without revealing eligibility", async () => {
    const references = Array.from({ length: 4 }, () => ({ ...destination }));
    const participants = Array.from({ length: 3 }, () => undefined);
    mocks.selectResults.set("event_survey_access as access", references);
    mocks.selectResults.set(
      "event_participation as participation",
      participants,
    );
    const { requestEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    const input = {
      publicReference: "H234567890_bcdefghijklmnopqrstuv",
      identifier: "bounded@example.com",
    };
    expect((await requestEventRecoveryCode(input)).status).toBe("accepted");
    expect((await requestEventRecoveryCode(input)).status).toBe("accepted");
    expect((await requestEventRecoveryCode(input)).status).toBe("accepted");
    expect((await requestEventRecoveryCode(input)).status).toBe("rate-limited");
  });

  it("fails closed and records only safe telemetry when delivery fails", async () => {
    mocks.selectResults.set("event_survey_access as access", [destination]);
    mocks.selectResults.set("event_participation as participation", [
      {
        eventParticipationId: "participation_1",
        userId: "user_1",
        identifier: "learner@example.com",
      },
    ]);
    mocks.selectResults.set("event_prerequisite_recovery_challenge", [
      { count: "0" },
    ]);
    mocks.sendEmail.mockRejectedValueOnce(new Error("provider secret"));
    const { requestEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      requestEventRecoveryCode({
        publicReference: "I234567890_bcdefghijklmnopqrstuv",
        identifier: "learner@example.com",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(mocks.deletes).toContain("event_prerequisite_recovery_challenge");
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "event_prerequisite.recovery_delivery_failed",
      }),
    );
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
      "provider secret",
    );
  });

  it("rejects unknown, expired and exhausted verification challenges", async () => {
    const now = Date.now();
    mocks.selectResults.set(
      "event_prerequisite_recovery_challenge as challenge",
      [
        undefined,
        {
          id: "expired",
          expiresAt: new Date(now - 1),
          consumedAt: null,
          attempts: 0,
          accessRevokedAt: null,
          occurrenceStatus: "published",
        },
        {
          id: "exhausted",
          expiresAt: new Date(now + 60_000),
          consumedAt: null,
          attempts: 5,
          accessRevokedAt: null,
          occurrenceStatus: "published",
        },
      ],
    );
    const { verifyEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    const base = {
      publicReference: "J234567890_bcdefghijklmnopqrstuv",
      challengeReference: "K234567890_bcdefghijklmnopqrstuv",
      code: "123456",
    };
    await expect(verifyEventRecoveryCode(base)).resolves.toEqual({
      status: "invalid",
    });
    await expect(verifyEventRecoveryCode(base)).resolves.toEqual({
      status: "expired",
    });
    await expect(verifyEventRecoveryCode(base)).resolves.toEqual({
      status: "rate-limited",
    });
  });

  it("increments incorrect attempts and closes the fifth attempt", async () => {
    const { createHmac } = await import("node:crypto");
    const wrongDigest = createHmac(
      "sha256",
      "test-secret-with-at-least-thirty-two-characters",
    )
      .update("code:challenge_wrong:654321")
      .digest("base64url");
    mocks.selectResults.set(
      "event_prerequisite_recovery_challenge as challenge",
      [
        {
          id: "challenge_wrong",
          codeDigest: wrongDigest,
          attempts: 4,
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
          accessRevokedAt: null,
          occurrenceStatus: "published",
        },
      ],
    );
    const { verifyEventRecoveryCode } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      verifyEventRecoveryCode({
        publicReference: "L234567890_bcdefghijklmnopqrstuv",
        challengeReference: "M234567890_bcdefghijklmnopqrstuv",
        code: "123456",
      }),
    ).resolves.toEqual({ status: "rate-limited" });
    expect(mocks.updates).toContainEqual({
      table: "event_prerequisite_recovery_challenge",
      values: { attempts: 5 },
    });
  });

  it("recognises authenticated access and schedule locks", async () => {
    mocks.selectResults.set("event_survey_access as access", [
      destination,
      destination,
    ]);
    mocks.resolveSurvey
      .mockResolvedValueOnce({
        status: "ready",
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
      })
      .mockResolvedValueOnce({ status: "unavailable" });
    const { resolveEventRecoveryLanding } =
      await import("./event-prerequisite-recovery.server");
    const user = {
      id: "user_1",
      name: "Learner",
      email: "learner@example.com",
      emailVerified: true,
    };
    await expect(
      resolveEventRecoveryLanding("N234567890_bcdefghijklmnopqrstuv", user),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      resolveEventRecoveryLanding("O234567890_bcdefghijklmnopqrstuv", user),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("prefers an exact task session to an unrelated authenticated user", async () => {
    const token = "t".repeat(43);
    mocks.headers = new Headers({ cookie: `upskill_event_task=${token}` });
    mocks.selectResults.set("event_prerequisite_task_session as task", [
      {
        taskSessionId: "task_1",
        eventSurveyAccessId: "survey_access_1",
        eventParticipationId: "participation_1",
        userId: "task_user",
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
        publicReference: "P234567890_bcdefghijklmnopqrstuv",
        name: "Task learner",
        email: "task@codestudio.au",
        emailVerified: true,
      },
    ]);
    const { resolveEventSurveyActor } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      resolveEventSurveyActor(
        {
          eventOccurrenceId: "occurrence_1",
          eventTemplateVersionItemId: "item_1",
        },
        {
          id: "authenticated_user",
          name: "Signed-in learner",
          email: "signed-in@codestudio.au",
          emailVerified: true,
        },
      ),
    ).resolves.toMatchObject({
      task: { taskSessionId: "task_1" },
      user: { id: "task_user" },
    });
  });

  it("uses an exact task session before resolving an authenticated landing", async () => {
    const token = "t".repeat(43);
    mocks.headers = new Headers({ cookie: `upskill_event_task=${token}` });
    mocks.selectResults.set("event_survey_access as access", [destination]);
    mocks.selectResults.set("event_prerequisite_task_session as task", [
      {
        taskSessionId: "task_1",
        eventSurveyAccessId: "survey_access_1",
        eventParticipationId: "participation_1",
        userId: "task_user",
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
        publicReference: "P234567890_bcdefghijklmnopqrstuv",
        name: "Task learner",
        email: "task@codestudio.au",
        emailVerified: true,
      },
    ]);
    const { resolveEventRecoveryLanding } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      resolveEventRecoveryLanding("P234567890_bcdefghijklmnopqrstuv", {
        id: "authenticated_user",
        name: "Signed-in learner",
        email: "signed-in@codestudio.au",
        emailVerified: true,
      }),
    ).resolves.toEqual({
      status: "ready",
      data: {
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
      },
    });
    expect(mocks.resolveSurvey).not.toHaveBeenCalled();
  });

  it("resolves and completes only the exact active task cookie", async () => {
    const token = "t".repeat(43);
    mocks.headers = new Headers({ cookie: `upskill_event_task=${token}` });
    mocks.selectResults.set("event_prerequisite_task_session as task", [
      {
        taskSessionId: "task_1",
        eventSurveyAccessId: "survey_access_1",
        eventParticipationId: "participation_1",
        userId: "user_1",
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
        publicReference: "P234567890_bcdefghijklmnopqrstuv",
        name: "Learner",
        email: "LEARNER@example.com",
        emailVerified: true,
      },
    ]);
    const { completeEventTaskSession, findEventTaskActor } =
      await import("./event-prerequisite-recovery.server");
    await expect(
      findEventTaskActor({
        eventOccurrenceId: "occurrence_1",
        eventTemplateVersionItemId: "item_1",
        eventParticipationId: "participation_1",
      }),
    ).resolves.toMatchObject({
      accessMode: "event_task",
      taskSessionId: "task_1",
      user: { email: "learner@example.com" },
    });
    await completeEventTaskSession("task_1");
    expect(mocks.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "event_prerequisite_task_session",
        }),
      ]),
    );
  });

  it("uses host-only secure cookies outside local environments", async () => {
    mocks.environment.APP_ENV = "production";
    const {
      clearEventRecoveryChallengeCookie,
      clearEventTaskSessionCookie,
      eventRecoveryChallengeCookie,
      eventTaskSessionCookie,
      readEventRecoveryChallengeCookie,
    } = await import("./event-prerequisite-recovery.server");
    expect(eventTaskSessionCookie("t".repeat(43))).toContain(
      "__Host-upskill_event_task=",
    );
    expect(eventTaskSessionCookie("t".repeat(43))).toContain("Secure");
    expect(clearEventTaskSessionCookie()).toContain("Max-Age=0");
    expect(clearEventTaskSessionCookie()).toContain("Secure");
    const reference = "Q234567890_bcdefghijklmnopqrstuv";
    expect(eventRecoveryChallengeCookie(reference)).toContain(
      `__Host-upskill_event_challenge=${reference}`,
    );
    expect(clearEventRecoveryChallengeCookie()).toContain("Max-Age=0");
    expect(
      readEventRecoveryChallengeCookie(
        new Request("https://upskill.example/event-surveys/reference", {
          headers: { cookie: `__Host-upskill_event_challenge=${reference}` },
        }),
      ),
    ).toBe(reference);
    expect(
      readEventRecoveryChallengeCookie(
        new Request("https://upskill.example/event-surveys/reference", {
          headers: { cookie: "__Host-upskill_event_challenge=invalid" },
        }),
      ),
    ).toBeNull();
  });
});
