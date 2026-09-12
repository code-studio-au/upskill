import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  getServerEnv: vi.fn(),
  accessDownload: vi.fn(),
  isDownloadActive: vi.fn(),
  getObjectStream: vi.fn(),
}));

vi.mock("#/server/auth/session.server", () => ({
  getRequestUser: mocks.getRequestUser,
}));
vi.mock("#/server/env.server", () => ({
  getServerEnv: mocks.getServerEnv,
}));
vi.mock("./event-virtual-recording-download.server", () => ({
  accessEventVirtualRecordingDownload: mocks.accessDownload,
  isEventVirtualRecordingDownloadActive: mocks.isDownloadActive,
}));
vi.mock("#/server/storage/object-storage.server", () => ({
  getObjectStream: mocks.getObjectStream,
}));

import { handleEventVirtualRecordingDownloadRequest } from "./event-virtual-recording-download-response.server";

const user = {
  id: "administrator_1",
  name: "Administrator",
  email: "administrator@example.com",
  emailVerified: true,
};

function request(range?: string): Request {
  return new Request(
    "https://upskill.example/api/play/recording_1?occurrence=occurrence_1&download=signed-token",
    range ? { headers: { range } } : {},
  );
}

describe("recording download response", () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.getServerEnv.mockReset();
    mocks.accessDownload.mockReset();
    mocks.isDownloadActive.mockReset();
    mocks.getObjectStream.mockReset();
    mocks.getRequestUser.mockResolvedValue(user);
    mocks.getServerEnv.mockReturnValue({
      S3_RECORDING_BUCKET: "recording-bucket",
    });
    mocks.isDownloadActive.mockResolvedValue(true);
  });

  it("rejects malformed ranges and unauthenticated requests before access", async () => {
    expect(
      (
        await handleEventVirtualRecordingDownloadRequest(
          "recording_1",
          new Request(
            "https://upskill.example/api/play/recording_1?occurrence=occurrence_1&download=",
          ),
        )
      ).status,
    ).toBe(404);
    expect(mocks.getRequestUser).not.toHaveBeenCalled();

    expect(
      (
        await handleEventVirtualRecordingDownloadRequest(
          "recording_1",
          request("bytes=4-1"),
        )
      ).status,
    ).toBe(416);
    expect(mocks.getRequestUser).not.toHaveBeenCalled();

    mocks.getRequestUser.mockResolvedValueOnce(null);
    expect(
      (
        await handleEventVirtualRecordingDownloadRequest(
          "recording_1",
          request(),
        )
      ).status,
    ).toBe(401);
    expect(mocks.accessDownload).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "forbidden" }, 403],
    [{ status: "not-found" }, 404],
    [{ status: "conflict", reason: "recording_unavailable" }, 409],
  ])(
    "maps private access outcome %# without detail leakage",
    async (outcome, status) => {
      mocks.accessDownload.mockResolvedValueOnce(outcome);

      const response = await handleEventVirtualRecordingDownloadRequest(
        "recording_1",
        request(),
      );

      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      expect(mocks.getObjectStream).not.toHaveBeenCalled();
    },
  );

  it("streams the exact private object as an attachment", async () => {
    const transferExpiresAt = new Date(Date.now() + 60 * 60_000);
    mocks.accessDownload.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        transferExpiresAt,
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

    const response = await handleEventVirtualRecordingDownloadRequest(
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
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="webinar-recording.mp4"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.isDownloadActive).toHaveBeenCalledWith(
      {
        eventOccurrenceId: "occurrence_1",
        recordingId: "recording_1",
        token: "signed-token",
      },
      user.id,
      transferExpiresAt,
    );
  });

  it("lets an admitted download continue after its initiation link expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    const cancel = vi.fn();
    let sourceController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    const transferExpiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    mocks.accessDownload.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        transferExpiresAt,
      },
    });
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({
        start(controller) {
          sourceController = controller;
        },
        cancel,
      }),
      contentLength: 1,
    });

    try {
      const response = await handleEventVirtualRecordingDownloadRequest(
        "recording_1",
        request(),
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Download response body is missing");
      const pendingRead = reader.read();
      await vi.advanceTimersByTimeAsync(60_001);
      sourceController?.enqueue(new Uint8Array([1]));
      sourceController?.close();

      await expect(pendingRead).resolves.toEqual({
        done: false,
        value: new Uint8Array([1]),
      });
      expect(cancel).not.toHaveBeenCalled();
      expect(mocks.isDownloadActive).toHaveBeenCalledWith(
        {
          eventOccurrenceId: "occurrence_1",
          recordingId: "recording_1",
          token: "signed-token",
        },
        user.id,
        transferExpiresAt,
      );
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds authorization reads while streaming fast source chunks", async () => {
    let chunk = 0;
    mocks.accessDownload.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        transferExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({
        pull(controller) {
          chunk += 1;
          if (chunk > 20) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array([chunk]));
        },
      }),
      contentLength: 20,
    });

    const response = await handleEventVirtualRecordingDownloadRequest(
      "recording_1",
      request(),
    );

    expect((await response.arrayBuffer()).byteLength).toBe(20);
    expect(mocks.isDownloadActive).toHaveBeenCalledTimes(1);
  });

  it("rechecks after a slow source read and cancels before emitting a revoked chunk", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    const cancel = vi.fn();
    let sourceController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    mocks.accessDownload.mockResolvedValueOnce({
      status: "ready",
      target: {
        storageObjectKey: "recordings/private.mp4",
        transferExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    mocks.isDownloadActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.getObjectStream.mockResolvedValueOnce({
      body: new ReadableStream({
        start(controller) {
          sourceController = controller;
        },
        cancel,
      }),
      contentLength: 1,
    });

    try {
      const response = await handleEventVirtualRecordingDownloadRequest(
        "recording_1",
        request(),
      );
      const pendingRead = response.body?.getReader().read();
      if (!pendingRead) throw new Error("Download response body is missing");
      const revoked = expect(pendingRead).rejects.toThrow(
        "Recording authorization revoked",
      );
      await vi.advanceTimersByTimeAsync(251);
      sourceController?.enqueue(new Uint8Array([1]));

      await revoked;
      expect(cancel).toHaveBeenCalledWith("Recording authorization revoked");
      expect(mocks.isDownloadActive).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
