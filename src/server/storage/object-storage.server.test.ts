import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => ({
    AWS_REGION: "ap-southeast-2",
    S3_ENDPOINT: undefined,
    S3_FORCE_PATH_STYLE: false,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
  }),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    S3Client: class {
      send = mocks.send;
    },
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    HeadObjectCommand: class HeadObjectCommand extends Command {},
    ListObjectsV2Command: class ListObjectsV2Command extends Command {},
    ListObjectVersionsCommand: class ListObjectVersionsCommand extends Command {},
    PutObjectCommand: class PutObjectCommand extends Command {},
  };
});

import { deleteVersionedObject } from "./object-storage.server";

function sentCommandInputs(): unknown[] {
  return mocks.send.mock.calls.map((call) => {
    const command: unknown = call[0];
    if (
      typeof command !== "object" ||
      command === null ||
      !("input" in command)
    )
      throw new TypeError("Expected a captured S3 command");
    return command.input;
  });
}

describe("deleteVersionedObject", () => {
  beforeEach(() => {
    mocks.send.mockReset();
  });

  it("purges every version and delete marker for the exact recording key", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        IsTruncated: true,
        NextKeyMarker: "recordings/session/recording.mp4",
        NextVersionIdMarker: "version-2",
        Versions: [
          {
            Key: "recordings/session/recording.mp4",
            VersionId: "version-1",
          },
          { Key: "recordings/session/recording.mp4.extra", VersionId: "x" },
        ],
        DeleteMarkers: [
          {
            Key: "recordings/session/recording.mp4",
            VersionId: "marker-1",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        IsTruncated: false,
        Versions: [
          {
            Key: "recordings/session/recording.mp4",
            VersionId: "version-2",
          },
        ],
      })
      .mockResolvedValueOnce({});

    await deleteVersionedObject(
      "private-recordings",
      "recordings/session/recording.mp4",
    );

    expect(sentCommandInputs()).toEqual([
      {
        Bucket: "private-recordings",
        Key: "recordings/session/recording.mp4",
      },
      {
        Bucket: "private-recordings",
        Prefix: "recordings/session/recording.mp4",
        KeyMarker: undefined,
        VersionIdMarker: undefined,
      },
      {
        Bucket: "private-recordings",
        Delete: {
          Objects: [
            {
              Key: "recordings/session/recording.mp4",
              VersionId: "version-1",
            },
            {
              Key: "recordings/session/recording.mp4",
              VersionId: "marker-1",
            },
          ],
          Quiet: true,
        },
      },
      {
        Bucket: "private-recordings",
        Prefix: "recordings/session/recording.mp4",
        KeyMarker: "recordings/session/recording.mp4",
        VersionIdMarker: "version-2",
      },
      {
        Bucket: "private-recordings",
        Delete: {
          Objects: [
            {
              Key: "recordings/session/recording.mp4",
              VersionId: "version-2",
            },
          ],
          Quiet: true,
        },
      },
    ]);
  });

  it("falls back to an idempotent delete for an unversioned local store", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: false });

    await deleteVersionedObject(
      "local-recordings",
      "recordings/session/local.mp4",
    );

    expect(sentCommandInputs()).toEqual([
      {
        Bucket: "local-recordings",
        Key: "recordings/session/local.mp4",
      },
      {
        Bucket: "local-recordings",
        Prefix: "recordings/session/local.mp4",
        KeyMarker: undefined,
        VersionIdMarker: undefined,
      },
    ]);
  });

  it("rejects partial version deletions", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        IsTruncated: false,
        Versions: [
          { Key: "recordings/session/recording.mp4", VersionId: "v1" },
        ],
      })
      .mockResolvedValueOnce({
        Errors: [{ Key: "recordings/session/recording.mp4", VersionId: "v1" }],
      });

    await expect(
      deleteVersionedObject(
        "private-recordings",
        "recordings/session/recording.mp4",
      ),
    ).rejects.toThrow("Stored recording versions could not be deleted");
  });

  it("rejects a truncated listing without a continuation marker", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: true });

    await expect(
      deleteVersionedObject(
        "private-recordings",
        "recordings/session/recording.mp4",
      ),
    ).rejects.toThrow("Stored recording version listing was incomplete");
  });
});
