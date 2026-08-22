import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import {
  deleteObject,
  getObjectBytes,
  putObject,
} from "#/server/storage/object-storage.server";
import {
  OFFERING_IMAGE_MAX_BYTES,
  type OfferingImageMediaType,
  type UploadedOfferingImage,
} from "#/features/shared/offering-image";

export class OfferingImageValidationError extends Error {
  constructor() {
    super("invalid_image");
    this.name = "OfferingImageValidationError";
  }
}

async function validateImage(
  bytes: Uint8Array,
  mediaType: OfferingImageMediaType,
): Promise<void> {
  try {
    const document = await PDFDocument.create();
    const image =
      mediaType === "image/png"
        ? await document.embedPng(bytes)
        : await document.embedJpg(bytes);
    if (
      image.width < 320 ||
      image.height < 180 ||
      image.width > 8192 ||
      image.height > 8192
    )
      throw new OfferingImageValidationError();
  } catch (error) {
    if (error instanceof OfferingImageValidationError) throw error;
    throw new OfferingImageValidationError();
  }
}

export async function uploadAdminOfferingImage(input: {
  displayName: string;
  mediaType: OfferingImageMediaType;
  bytes: Uint8Array;
  administrator: AuthenticatedUser;
}): Promise<UploadedOfferingImage> {
  await validateImage(input.bytes, input.mediaType);
  const assetId = `offering_image_${randomUUID()}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const extension = input.mediaType === "image/png" ? "png" : "jpg";
  const objectKey = `offering-images/${assetId}/${sha256}.${extension}`;
  const bucket = getServerEnv().S3_PRIVATE_RESOURCES_BUCKET;
  let objectCreated = false;
  try {
    objectCreated =
      (await putObject({
        Bucket: bucket,
        Key: objectKey,
        Body: input.bytes,
        ContentType: input.mediaType,
        ContentLength: input.bytes.byteLength,
        Metadata: { sha256 },
      })) === "created";
    await getDatabase()
      .insertInto("offering_image_asset")
      .values({
        id: assetId,
        displayName: input.displayName,
        objectKey,
        mediaType: input.mediaType,
        sourceBytes: input.bytes.byteLength,
        sha256,
        createdByUserId: input.administrator.id,
      })
      .executeTakeFirstOrThrow();
    return {
      assetId,
      displayName: input.displayName,
      mediaType: input.mediaType,
    };
  } catch (error) {
    if (objectCreated) await deleteObject(bucket, objectKey).catch(() => {});
    throw error;
  }
}

export async function getAdminOfferingImage(assetId: string): Promise<
  | { status: "not-found" }
  | {
      status: "ready";
      bytes: Uint8Array;
      mediaType: OfferingImageMediaType;
    }
> {
  if (assetId.length > 128) return { status: "not-found" };
  const asset = await getDatabase()
    .selectFrom("offering_image_asset")
    .select(["objectKey", "mediaType"])
    .where("id", "=", assetId)
    .executeTakeFirst();
  if (!asset) return { status: "not-found" };
  return {
    status: "ready",
    bytes: await getObjectBytes(
      getServerEnv().S3_PRIVATE_RESOURCES_BUCKET,
      asset.objectKey,
      OFFERING_IMAGE_MAX_BYTES,
    ),
    mediaType: asset.mediaType,
  };
}
