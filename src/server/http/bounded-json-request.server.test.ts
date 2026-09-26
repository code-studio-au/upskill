import { describe, expect, it } from "vitest";
import { readBoundedJsonRequest } from "#/server/http/bounded-json-request.server";

describe("bounded JSON request reader", () => {
  it("accepts a bounded JSON request", async () => {
    await expect(
      readBoundedJsonRequest(
        new Request("https://app.example.test/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"ok":true}',
        }),
        32,
      ),
    ).resolves.toEqual({ status: "ok", value: { ok: true } });
  });

  it("rejects unsupported, malformed and oversized bodies", async () => {
    await expect(
      readBoundedJsonRequest(
        new Request("https://app.example.test/api", {
          method: "POST",
          body: "plain",
        }),
        32,
      ),
    ).resolves.toMatchObject({
      status: "error",
      responseStatus: 415,
    });
    await expect(
      readBoundedJsonRequest(
        new Request("https://app.example.test/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
        32,
      ),
    ).resolves.toMatchObject({ status: "error", error: "invalid_json" });
    await expect(
      readBoundedJsonRequest(
        new Request("https://app.example.test/api", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "100",
          },
          body: "{}",
        }),
        32,
      ),
    ).resolves.toMatchObject({
      status: "error",
      error: "payload_too_large",
    });
  });
});
