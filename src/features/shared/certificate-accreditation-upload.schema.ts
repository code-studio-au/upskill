import { z } from "#/validation/zod";

export const ACCREDITATION_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const accreditationLogoUploadQuerySchema = z.object({
  displayName: z.string().check(z.trim(), z.minLength(1), z.maxLength(255)),
});

export type AccreditationLogoMediaType = "image/png" | "image/jpeg";

export interface UploadedAccreditationLogo {
  assetId: string;
  displayName: string;
  mediaType: AccreditationLogoMediaType;
}
