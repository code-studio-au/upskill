import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import {
  deleteObject,
  putObject,
} from "#/server/storage/object-storage.server";
import type {
  AccreditationLogoMediaType,
  UploadedAccreditationLogo,
} from "#/features/shared/certificate-accreditation-upload.schema";

export class AccreditationLogoValidationError extends Error {
  constructor() {
    super("invalid_image");
    this.name = "AccreditationLogoValidationError";
  }
}

async function validateImage(
  bytes: Uint8Array,
  mediaType: AccreditationLogoMediaType,
): Promise<void> {
  try {
    const document = await PDFDocument.create();
    const image =
      mediaType === "image/png"
        ? await document.embedPng(bytes)
        : await document.embedJpg(bytes);
    if (
      image.width < 16 ||
      image.height < 16 ||
      image.width > 4096 ||
      image.height > 4096
    )
      throw new AccreditationLogoValidationError();
  } catch (error) {
    if (error instanceof AccreditationLogoValidationError) throw error;
    throw new AccreditationLogoValidationError();
  }
}

export async function uploadAdminAccreditationLogo(input: {
  displayName: string;
  mediaType: AccreditationLogoMediaType;
  bytes: Uint8Array;
  administrator: AuthenticatedUser;
}): Promise<UploadedAccreditationLogo> {
  await validateImage(input.bytes, input.mediaType);
  const assetId = `accreditation_logo_${randomUUID()}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const extension = input.mediaType === "image/png" ? "png" : "jpg";
  const objectKey = `accreditation-logos/${assetId}/${sha256}.${extension}`;
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
      .insertInto("accreditation_logo_asset")
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
