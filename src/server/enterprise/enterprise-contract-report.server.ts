import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";

export interface EnterpriseContractUtilisationReport {
  contract: {
    id: string;
    reference: string;
    name: string;
    organizationName: string;
  };
  rows: Array<{
    learnerName: string;
    learnerEmail: string;
    claimedAt: string;
    offeringType: "course" | "event" | "claim";
    offeringTitle: string | null;
    accessStatus: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export async function findEnterpriseContractUtilisationReport(
  database: Kysely<Database>,
  enterpriseContractId: string,
): Promise<EnterpriseContractUtilisationReport | null> {
  const contract = await database
    .selectFrom("enterprise_contract as contract")
    .innerJoin("organization", "organization.id", "contract.organizationId")
    .select([
      "contract.id",
      "contract.reference",
      "contract.name",
      "organization.name as organizationName",
    ])
    .where("contract.id", "=", enterpriseContractId)
    .executeTakeFirst();
  if (!contract) return null;
  const claims = await database
    .selectFrom("enterprise_contract_claim as claim")
    .innerJoin("user", "user.id", "claim.userId")
    .select(["claim.id", "claim.emailSnapshot", "claim.claimedAt", "user.name"])
    .where("claim.enterpriseContractId", "=", contract.id)
    .where("claim.revokedAt", "is", null)
    .where("claim.informationReleaseAcceptedAt", "is not", null)
    .orderBy("claim.claimedAt")
    .execute();
  const claimIds = claims.map((claim) => claim.id);
  const [courses, events] =
    claimIds.length === 0
      ? [[], []]
      : await Promise.all([
          database
            .selectFrom("entitlement")
            .innerJoin(
              "enrollment",
              "enrollment.id",
              "entitlement.enrollmentId",
            )
            .innerJoin(
              "course_version",
              "course_version.id",
              "entitlement.courseVersionId",
            )
            .innerJoin("course", "course.id", "course_version.courseId")
            .select([
              "entitlement.originEnterpriseContractClaimId as claimId",
              "course.title",
              "enrollment.status",
              "enrollment.enrolledAt",
              "enrollment.completedAt",
            ])
            .where(
              "entitlement.originEnterpriseContractClaimId",
              "in",
              claimIds,
            )
            .where("entitlement.revokedAt", "is", null)
            .execute(),
          database
            .selectFrom(
              "enterprise_contract_event_registration as contractRegistration",
            )
            .innerJoin(
              "event_registration",
              "event_registration.id",
              "contractRegistration.eventRegistrationId",
            )
            .innerJoin(
              "event_occurrence",
              "event_occurrence.id",
              "event_registration.eventOccurrenceId",
            )
            .innerJoin(
              "event_participation",
              "event_participation.registrationId",
              "event_registration.id",
            )
            .select([
              "contractRegistration.enterpriseContractClaimId as claimId",
              "event_occurrence.title",
              "event_registration.status",
              "contractRegistration.registeredAt",
              "event_participation.completedAt",
            ])
            .where(
              "contractRegistration.enterpriseContractClaimId",
              "in",
              claimIds,
            )
            .execute(),
        ]);
  const rows: EnterpriseContractUtilisationReport["rows"] = [];
  for (const claim of claims) {
    const claimCourses = courses.filter(
      (course) => course.claimId === claim.id,
    );
    const claimEvents = events.filter((event) => event.claimId === claim.id);
    if (claimCourses.length === 0 && claimEvents.length === 0)
      rows.push({
        learnerName: claim.name,
        learnerEmail: claim.emailSnapshot,
        claimedAt: claim.claimedAt.toISOString(),
        offeringType: "claim",
        offeringTitle: null,
        accessStatus: "claimed",
        startedAt: null,
        completedAt: null,
      });
    for (const course of claimCourses)
      rows.push({
        learnerName: claim.name,
        learnerEmail: claim.emailSnapshot,
        claimedAt: claim.claimedAt.toISOString(),
        offeringType: "course",
        offeringTitle: course.title,
        accessStatus: course.status,
        startedAt: course.enrolledAt.toISOString(),
        completedAt: course.completedAt?.toISOString() ?? null,
      });
    for (const event of claimEvents)
      rows.push({
        learnerName: claim.name,
        learnerEmail: claim.emailSnapshot,
        claimedAt: claim.claimedAt.toISOString(),
        offeringType: "event",
        offeringTitle: event.title,
        accessStatus: event.status,
        startedAt: event.registeredAt.toISOString(),
        completedAt: event.completedAt?.toISOString() ?? null,
      });
  }
  return { contract, rows };
}
