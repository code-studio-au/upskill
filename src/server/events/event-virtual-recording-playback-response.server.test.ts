import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  getServerEnv: vi.fn(),
  accessPlayback: vi.fn(),
  getObjectStream: vi.fn(),
}));

vi.mock("#/server/auth/session.server", () => ({
  getRequestUser: mocks.getRequestUser,
}));
vi.mock("#/server/env.server", () => ({
  getServerEnv: mocks.getServerEnv,
}));
vi.mock("./event-virtual-recording-playback.server", () => ({
  accessEventVirtualRecordingPlayback: mocks.accessPlayback,
}));
vi.mock("#/server/storage/object-storage.server", () => ({
  getObjectStream: mocks.getObjectStream,
}));

import { handleEventVirtualRecordingPlaybackRequest } from "./event-virtual-recording-playback-response.server";

const user = {
  id: "administrator_1",
  name: "Administrator",
  email: "administrator@example.com",
  emailVerified: true,
};

function request(range?: string): Request {
  return new Request(
    "https://upskill.example/api/play/recording_1?occurrence=occurrence_1",
    range ? { headers: { range } } : {},
  );
}

describe("recording playback response", () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.getServerEnv.mockReset();
    mocks.accessPlayback.mockReset();
    mocks.getObjectStream.mockReset();
    mocks.getRequestUser.mockResolvedValue(user);
    mocks.getServerEnv.mockReturnValue({
      S3_RECORDING_BUCKET: "recording-bucket",
    });
  });

  it("rejects malformed ranges and unauthenticated requests before access", async () => {
    expect(
      (
        await handleEventVirtualRecordingPlaybackRequest(
          "recording_1",
          request("bytes=4-1"),
        )
      ).status,
    ).toBe(416);
    expect(mocks.getRequestUser).not.toHaveBeenCalled();

    mocks.getRequestUser.mockResolvedValueOnce(null);
    expect(
      (
        await handleEventVirtualRecordingPlaybackRequest(
          "recording_1",
          request(),
        )
      ).status,
    ).toBe(401);
    expect(mocks.accessPlayback).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "forbidden" }, 403],
    [{ status: "not-found" }, 404],
    [{ status: "conflict", reason: "recording_unavailable" }, 409],
  ])(
    "maps private access outcome %# without detail leakage",
    async (outcome, status) => {
      mocks.accessPlayback.mockResolvedValueOnce(outcome);
      const response = await handleEventVirtualRecordingPlaybackRequest(
        "recording_1",
        request(),
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      expect(mocks.getObjectStream).not.toHaveBeenCalled();
    },
  );

  it("streams the exact private object with seek and hardening headers", async () => {
    mocks.accessPlayback.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.close();
        },
      }),
      contentLength: 2,
      contentRange: "bytes 0-1/10",
      etag: '"recording-etag"',
    });

    const response = await handleEventVirtualRecordingPlaybackRequest(
      "recording_1",
      request("bytes=0-1"),
    );

    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(mocks.getObjectStream).toHaveBeenCalledWith(
      "recording-bucket",
      "recordings/private.mp4",
      "bytes=0-1",
    );
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("bounds open ranges so continued playback reauthorizes", async () => {
    mocks.accessPlayback.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      contentLength: 8 * 1024 * 1024,
      contentRange: "bytes 0-8388607/20000000",
    });

    const response = await handleEventVirtualRecordingPlaybackRequest(
      "recording_1",
      request("bytes=0-"),
    );

    expect(mocks.getObjectStream).toHaveBeenCalledWith(
      "recording-bucket",
      "recordings/private.mp4",
      "bytes=0-8388607",
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      "bytes 0-8388607/20000000",
    );
    await response.body?.cancel();
  });

  it("cancels a no-range stream when its authorized session expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
    const cancel = vi.fn();
    mocks.accessPlayback.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        expiresAt: new Date(Date.now() + 1_000),
      },
    });
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({ cancel }),
      contentLength: 20_000_000,
    });

    try {
      const response = await handleEventVirtualRecordingPlaybackRequest(
        "recording_1",
        request(),
      );
      const responseBody = response.body;
      if (!responseBody) throw new Error("Playback response body is missing");
      const pendingRead = responseBody.getReader().read();
      const expiryRejection = expect(pendingRead).rejects.toThrow(
        "Playback authorization expired",
      );
      await vi.advanceTimersByTimeAsync(1_000);

      await expiryRejection;
      expect(cancel).toHaveBeenCalledWith("Playback authorization expired");
      expect(mocks.getObjectStream).toHaveBeenCalledWith(
        "recording-bucket",
        "recordings/private.mp4",
        undefined,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["NoSuchKey", 404],
    ["RequestedRangeNotSatisfiable", 416],
  ])("maps private object error %s to %i", async (name, status) => {
    mocks.accessPlayback.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mocks.getObjectStream.mockRejectedValueOnce({ name });
    expect(
      (
        await handleEventVirtualRecordingPlaybackRequest(
          "recording_1",
          request(),
        )
      ).status,
    ).toBe(status);
  });
});
