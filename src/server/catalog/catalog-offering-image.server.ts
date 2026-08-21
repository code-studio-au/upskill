import "@tanstack/react-start/server-only";

import { OFFERING_IMAGE_MAX_BYTES } from "#/features/shared/offering-image";
import {
  findCourseBySlug,
  findEventBySlug,
} from "#/server/catalog/catalog.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { getObjectBytes } from "#/server/storage/object-storage.server";

export async function getPublishedCourseOfferingImage(input: {
  slug: string;
  assetId: string;
}): Promise<
  | { status: "not-found" }
  | {
      status: "ready";
      bytes: Uint8Array;
      mediaType: "image/png" | "image/jpeg";
      sha256: string;
    }
> {
  if (input.assetId.length > 128) return { status: "not-found" };
  const course = await findCourseBySlug(input.slug);
  if (course?.coverImage?.assetId !== input.assetId)
    return { status: "not-found" };
  const asset = await getDatabase()
    .selectFrom("offering_image_asset")
    .select(["objectKey", "mediaType", "sha256"])
    .where("id", "=", input.assetId)
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
    sha256: asset.sha256,
  };
}

export async function getPublishedEventOfferingImage(input: {
  slug: string;
  assetId: string;
}): Promise<
  | { status: "not-found" }
  | {
      status: "ready";
      bytes: Uint8Array;
      mediaType: "image/png" | "image/jpeg";
      sha256: string;
    }
> {
  if (input.assetId.length > 128) return { status: "not-found" };
  const event = await findEventBySlug(input.slug);
  if (event?.coverImage?.assetId !== input.assetId)
    return { status: "not-found" };
  const asset = await getDatabase()
    .selectFrom("offering_image_asset")
    .select(["objectKey", "mediaType", "sha256"])
    .where("id", "=", input.assetId)
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
    sha256: asset.sha256,
  };
}
