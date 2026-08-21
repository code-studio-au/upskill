import "@tanstack/react-start/server-only";

import { ACCREDITATION_LOGO_MAX_BYTES } from "#/features/shared/certificate-accreditation-upload.schema";
import {
  findCourseBySlug,
  findEventBySlug,
} from "#/server/catalog/catalog.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { getObjectBytes } from "#/server/storage/object-storage.server";

export type PublishedCourseAccreditationLogo =
  | { status: "not-found" }
  | {
      status: "ready";
      bytes: Uint8Array;
      mediaType: "image/png" | "image/jpeg";
      sha256: string;
    };

export async function getPublishedCourseAccreditationLogo(input: {
  slug: string;
  assetId: string;
}): Promise<PublishedCourseAccreditationLogo> {
  if (input.assetId.length > 128) return { status: "not-found" };
  const course = await findCourseBySlug(input.slug);
  if (
    !course?.accreditations.some(
      (accreditation) => accreditation.logoAssetId === input.assetId,
    )
  )
    return { status: "not-found" };

  const asset = await getDatabase()
    .selectFrom("accreditation_logo_asset")
    .select(["objectKey", "mediaType", "sha256"])
    .where("id", "=", input.assetId)
    .executeTakeFirst();
  if (!asset) return { status: "not-found" };

  return {
    status: "ready",
    bytes: await getObjectBytes(
      getServerEnv().S3_PRIVATE_RESOURCES_BUCKET,
      asset.objectKey,
      ACCREDITATION_LOGO_MAX_BYTES,
    ),
    mediaType: asset.mediaType,
    sha256: asset.sha256,
  };
}

export async function getPublishedEventAccreditationLogo(input: {
  slug: string;
  assetId: string;
}): Promise<PublishedCourseAccreditationLogo> {
  if (input.assetId.length > 128) return { status: "not-found" };
  const event = await findEventBySlug(input.slug);
  if (!event?.accreditations.some((item) => item.logoAssetId === input.assetId))
    return { status: "not-found" };
  const asset = await getDatabase()
    .selectFrom("accreditation_logo_asset")
    .select(["objectKey", "mediaType", "sha256"])
    .where("id", "=", input.assetId)
    .executeTakeFirst();
  if (!asset) return { status: "not-found" };
  return {
    status: "ready",
    bytes: await getObjectBytes(
      getServerEnv().S3_PRIVATE_RESOURCES_BUCKET,
      asset.objectKey,
      ACCREDITATION_LOGO_MAX_BYTES,
    ),
    mediaType: asset.mediaType,
    sha256: asset.sha256,
  };
}
