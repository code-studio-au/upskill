import { z } from "#/validation/zod";

const certificateAccreditationSchema = z
  .object({
    name: z.string().check(z.trim(), z.minLength(1), z.maxLength(160)),
    cpdPoints: z.nullable(z.number().check(z.nonnegative(), z.maximum(10_000))),
    blurb: z._default(z.string().check(z.trim(), z.maxLength(400)), ""),
    logoAssetId: z._default(
      z.nullable(
        z
          .string()
          .check(
            z.regex(/^accreditation_logo_[A-Za-z0-9_-]+$/u),
            z.maxLength(255),
          ),
      ),
      null,
    ),
    logoName: z._default(z.string().check(z.trim(), z.maxLength(255)), ""),
  })
  .check(
    z.superRefine((accreditation, context) => {
      if (accreditation.logoAssetId && !accreditation.logoName.trim())
        context.addIssue({
          code: "custom",
          path: ["logoName"],
          message: "Enter a logo name.",
        });
    }),
  );

export const certificateAccreditationsSchema = z
  .array(certificateAccreditationSchema)
  .check(z.maxLength(5));

export type CertificateAccreditation = z.infer<
  typeof certificateAccreditationSchema
>;
