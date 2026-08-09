import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logAuditEvent,
  logServerEvent,
  MAX_SERVER_LOG_BYTES,
} from "./server-logger";

const ORIGINAL_APP_ENV = process.env.APP_ENV;
const ORIGINAL_LOG_LEVEL = process.env.UPSKILL_LOG_LEVEL;

function parseLog(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("string");
  return JSON.parse(String(value)) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_APP_ENV === undefined)
    Reflect.deleteProperty(process.env, "APP_ENV");
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
  if (ORIGINAL_LOG_LEVEL === undefined)
    Reflect.deleteProperty(process.env, "UPSKILL_LOG_LEVEL");
  else process.env.UPSKILL_LOG_LEVEL = ORIGINAL_LOG_LEVEL;
});

describe("structured server logging", () => {
  it("classifies errors without serializing private details", () => {
    const privateValue = "Bearer private-token-value";
    const error = new Error(`Provider failed with ${privateValue}`);
    Object.assign(error, {
      headers: { cookie: "session=private-cookie" },
      toJSON() {
        throw new Error("must not serialize the raw error");
      },
    });
    const output = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerEvent({
      level: "error",
      event: "checkout.creation_failed",
      error,
      fields: {
        requestId: "req_safe",
        orderId: "order_safe",
        authorization: privateValue,
      },
    });

    const raw = String(output.mock.calls[0]?.[0]);
    expect(parseLog(raw)).toMatchObject({
      service: "upskill",
      level: "error",
      type: "checkout.creation_failed",
      category: "operational",
      requestId: "req_safe",
      orderId: "order_safe",
      errorType: "Error",
    });
    expect(raw).not.toMatch(/private-token|private-cookie/u);
  });

  it("sanitizes audit fields and always includes a stable envelope", () => {
    process.env.APP_ENV = "test";
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    logAuditEvent({
      event: "enrollment.purchased",
      fields: {
        eventId: "audit_1",
        actorUserId: "user_1",
        entityType: "enrollment",
        entityId: "enrollment_1",
        privatePayload: "private",
      },
    });
    const raw = String(output.mock.calls[0]?.[0]);
    expect(parseLog(raw)).toMatchObject({
      service: "upskill",
      environment: "test",
      level: "info",
      type: "enrollment.purchased",
      category: "audit",
      eventId: "audit_1",
      actorUserId: "user_1",
      entityType: "enrollment",
      entityId: "enrollment_1",
    });
    expect(raw).not.toContain("private");
  });

  it("honours the operational log level independently of audit logs", () => {
    process.env.UPSKILL_LOG_LEVEL = "error";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerEvent({ level: "info", event: "worker.idle" });
    logAuditEvent({ event: "order.checkout_paid", fields: {} });
    logServerEvent({ level: "error", event: "worker.failed" });
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("caps serialized output and tolerates adversarial thrown values", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adversarial = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("private proxy value");
        },
      },
    );
    logServerEvent({
      level: "warn",
      event: "Invalid event",
      error: adversarial,
      fields: { requestId: "x".repeat(20_000) },
    });
    const raw = String(output.mock.calls[0]?.[0]);
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      MAX_SERVER_LOG_BYTES,
    );
    expect(parseLog(raw)).toMatchObject({
      type: "invalid_server_log_event",
      errorType: "UnknownThrownValue",
    });
    expect(raw).not.toContain("private proxy value");
  });

  it.each([
    [null, "NullThrownValue"],
    [undefined, "UndefinedThrownValue"],
    [42, "NonErrorThrownValue"],
    [new TypeError("private"), "TypeError"],
    [new RangeError("private"), "RangeError"],
    [new SyntaxError("private"), "SyntaxError"],
    [new AggregateError([], "private"), "AggregateError"],
  ])("classifies thrown values without inspecting them", (thrown, expected) => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerEvent({
      level: "error",
      event: "worker.failed",
      error: thrown,
    });
    expect(parseLog(output.mock.calls[0]?.[0])).toMatchObject({
      errorType: expected,
    });
  });

  it("replaces an oversized structured entry with a bounded marker", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    const large = "🙂".repeat(600);
    logServerEvent({
      level: "info",
      event: "worker.completed",
      fields: {
        requestId: large,
        eventId: large,
        messageId: large,
        actorUserId: large,
        entityType: large,
        entityId: large,
        aggregateId: large,
        packageVersionId: large,
        enrollmentId: large,
        orderId: large,
        method: large,
        path: large,
        status: large,
        outcome: large,
        code: large,
        reasonCode: large,
      },
    });
    const raw = String(output.mock.calls[0]?.[0]);
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      MAX_SERVER_LOG_BYTES,
    );
    expect(parseLog(raw)).toMatchObject({
      type: "server_log_entry_too_large",
      category: "operational",
    });
  });

  it("can disable operational output without suppressing audit projections", () => {
    process.env.UPSKILL_LOG_LEVEL = "off";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logServerEvent({ level: "info", event: "worker.idle" });
    logAuditEvent({ event: "order.checkout_failed", fields: {} });
    expect(info).toHaveBeenCalledTimes(1);
    expect(parseLog(info.mock.calls[0]?.[0])).toMatchObject({
      category: "audit",
    });
  });
});
