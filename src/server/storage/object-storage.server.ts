import "@tanstack/react-start/server-only";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getServerEnv } from "#/server/env.server";

let client: S3Client | undefined;

function getObjectStorageClient(): S3Client {
  if (client) return client;
  const env = getServerEnv();
  if (
    (env.S3_ACCESS_KEY_ID === undefined) !==
    (env.S3_SECRET_ACCESS_KEY === undefined)
  )
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together",
    );
  const hasConfiguredCredentials =
    env.S3_ACCESS_KEY_ID !== undefined &&
    env.S3_SECRET_ACCESS_KEY !== undefined;
  const configuredCredentials =
    hasConfiguredCredentials && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {};
  client = new S3Client({
    region: env.AWS_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...configuredCredentials,
  });
  return client;
}

export async function putObject(
  input: PutObjectCommandInput,
): Promise<"created" | "existing"> {
  try {
    await getObjectStorageClient().send(
      new PutObjectCommand({ ...input, IfNoneMatch: "*" }),
    );
    return "created";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "PreconditionFailed"
    )
      return "existing";
    throw error;
  }
}

export async function objectExists(
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await getObjectStorageClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error.name === "NotFound" || error.name === "NoSuchKey")
    )
      return false;
    throw error;
  }
}

export async function getObjectBytes(
  bucket: string,
  key: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const response = await getObjectStorageClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.ContentLength && response.ContentLength > maximumBytes)
    throw new Error("Stored object exceeds the configured byte limit");
  if (!response.Body) throw new Error("Stored object has no body");
  const bytes = await response.Body.transformToByteArray();
  if (bytes.byteLength > maximumBytes)
    throw new Error("Stored object exceeds the configured byte limit");
  return bytes;
}

export interface StoredObjectStream {
  body: ReadableStream<Uint8Array>;
  cacheControl: string | undefined;
  contentLength: number | undefined;
  contentRange: string | undefined;
  contentType: string | undefined;
  etag: string | undefined;
}

export async function getObjectStream(
  bucket: string,
  key: string,
  range?: string,
): Promise<StoredObjectStream> {
  const response = await getObjectStorageClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
  );
  if (!response.Body) throw new Error("Stored object has no body");
  const body =
    response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  return {
    body,
    cacheControl: response.CacheControl,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    contentType: response.ContentType,
    etag: response.ETag,
  };
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getObjectStorageClient().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}

export async function deleteObjectPrefix(
  bucket: string,
  prefix: string,
): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const page = await getObjectStorageClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (page.Contents ?? [])
      .map(({ Key }) => (Key ? { Key } : undefined))
      .filter((value): value is { Key: string } => value !== undefined);
    if (objects.length > 0)
      await getObjectStorageClient().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
}
