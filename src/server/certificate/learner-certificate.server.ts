import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import {
  certificateAccreditationsSchema,
  type CertificateAccreditation,
} from "#/features/catalog/accreditation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { renderCompletionCertificate } from "#/server/certificate/completion-certificate-pdf.server";
import { getDatabase } from "#/server/db/database.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { getServerEnv } from "#/server/env.server";
import { getObjectBytes } from "#/server/storage/object-storage.server";
import { eventRegistrationQuestionnaireComplete } from "#/server/registration/registration-questionnaire-access.server";

export type LearnerCertificateResult =
  | { status: "generated"; bytes: Uint8Array; displayName: string }
  | { status: "not-found" | "unavailable" };

function safeFilename(value: string): string {
  const filename = value
    .normalize("NFKD")
    .replaceAll(/[^A-Za-z0-9 -]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-")
    .slice(0, 100);
  return `${filename || "learning"}-completion-certificate.pdf`;
}

async function hydrateAccreditationLogos(
  accreditations: Array<CertificateAccreditation>,
) {
  const customIds = [
    ...new Set(
      accreditations.flatMap((accreditation) =>
        accreditation.logoAssetId ? [accreditation.logoAssetId] : [],
      ),
    ),
  ];
  if (customIds.length === 0) return accreditations;
  const assets = await getDatabase()
    .selectFrom("accreditation_logo_asset")
    .select(["id", "objectKey", "mediaType"])
    .where("id", "in", customIds)
    .execute();
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const bucket = getServerEnv().S3_PRIVATE_RESOURCES_BUCKET;
  return Promise.all(
    accreditations.map(async (accreditation) => {
      if (!accreditation.logoAssetId) return accreditation;
      const asset = assetById.get(accreditation.logoAssetId);
      if (!asset) return accreditation;
      return {
        ...accreditation,
        logoMediaType: asset.mediaType,
        logoBytes: await getObjectBytes(
          bucket,
          asset.objectKey,
          2 * 1024 * 1024,
        ),
      };
    }),
  );
}

export async function getLearnerCompletionCertificate(
  enrollmentId: string,
  user: AuthenticatedUser,
): Promise<LearnerCertificateResult> {
  const completion = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin("user", "user.id", "enrollment.userId")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .select([
      "enrollment.completedAt",
      "course_version.content",
      "user.name as learnerName",
    ])
    .where("enrollment.id", "=", enrollmentId)
    .where("enrollment.userId", "=", user.id)
    .where("enrollment.status", "=", "completed")
    .where("enrollment.completedAt", "is not", null)
    .executeTakeFirst();
  if (!completion?.completedAt) return { status: "not-found" };

  const content = courseContentSchema.parse(completion.content);
  if (!content.hasCompletionCertificate) return { status: "not-found" };

  const completionReference = createHash("sha256")
    .update(`${enrollmentId}:${completion.completedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();

  try {
    return {
      status: "generated",
      bytes: await renderCompletionCertificate({
        completionReference,
        learnerName: completion.learnerName,
        learningTitle: content.title,
        learningSummary: content.summary,
        accreditations: await hydrateAccreditationLogos(content.accreditations),
        completedAt: completion.completedAt,
      }),
      displayName: safeFilename(content.title),
    };
  } catch (error) {
    logServerEvent({
      level: "error",
      event: "certificate.render_failed",
      error,
      fields: { entityType: "enrollment", entityId: enrollmentId },
    });
    return { status: "unavailable" };
  }
}

export async function getLearnerEventCompletionCertificate(
  eventParticipationId: string,
  user: AuthenticatedUser,
): Promise<LearnerCertificateResult> {
  const completion = await getDatabase()
    .selectFrom("event_participation as participation")
    .innerJoin("user", "user.id", "participation.userId")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select([
      "participation.completedAt",
      "participation.eventOccurrenceId",
      "occurrence.title",
      "version.hasCompletionCertificate",
      "version.summary",
      "version.accreditations",
      "user.name as learnerName",
    ])
    .where("participation.id", "=", eventParticipationId)
    .where("participation.userId", "=", user.id)
    .where("participation.completedAt", "is not", null)
    .executeTakeFirst();
  if (!completion?.completedAt || !completion.hasCompletionCertificate)
    return { status: "not-found" };
  if (
    !(await eventRegistrationQuestionnaireComplete(
      getDatabase(),
      completion.eventOccurrenceId,
      user.id,
    ))
  )
    return { status: "not-found" };
  const completionReference = createHash("sha256")
    .update(`${eventParticipationId}:${completion.completedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  try {
    const accreditations = certificateAccreditationsSchema.parse(
      completion.accreditations,
    );
    return {
      status: "generated",
      bytes: await renderCompletionCertificate({
        completionReference,
        learnerName: completion.learnerName,
        learningTitle: completion.title,
        learningSummary: completion.summary,
        accreditations: await hydrateAccreditationLogos(accreditations),
        completedAt: completion.completedAt,
      }),
      displayName: safeFilename(completion.title),
    };
  } catch (error) {
    logServerEvent({
      level: "error",
      event: "certificate.render_failed",
      error,
      fields: {
        entityType: "event_participation",
        entityId: eventParticipationId,
      },
    });
    return { status: "unavailable" };
  }
}
