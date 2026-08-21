import { z } from "#/validation/zod";

export const OFFERING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const offeringImageSchema = z.nullable(
  z.object({
    assetId: z.string().check(z.regex(/^offering_image_[A-Za-z0-9_-]+$/u)),
    altText: z.string().check(z.trim(), z.minLength(1), z.maxLength(240)),
  }),
);

export const offeringImageUploadQuerySchema = z.object({
  displayName: z.string().check(z.trim(), z.minLength(1), z.maxLength(255)),
});

export type OfferingImage = z.infer<typeof offeringImageSchema>;
export type OfferingImageMediaType = "image/png" | "image/jpeg";

export interface UploadedOfferingImage {
  assetId: string;
  displayName: string;
  mediaType: OfferingImageMediaType;
}
