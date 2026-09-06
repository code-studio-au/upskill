import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";

export async function lockEventVirtualAdmissionEligibility(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventParticipationId: string;
    registrationSurveyVersionId: string | null;
  },
): Promise<boolean> {
  const participation = await transaction
    .selectFrom("event_participation")
    .select(["registrationId", "userId"])
    .where("id", "=", input.eventParticipationId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("mode", "=", "registered")
    .executeTakeFirst();
  if (!participation) return false;

  const registration = await transaction
    .selectFrom("event_registration")
    .select("status")
    .where("id", "=", participation.registrationId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("userId", "=", participation.userId)
    .forUpdate()
    .executeTakeFirst();
  if (registration?.status !== "selected") return false;
  if (!input.registrationSurveyVersionId) return true;

  const assignment = await transaction
    .selectFrom("registration_questionnaire_assignment")
    .select("status")
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("userId", "=", participation.userId)
    .where("surveyVersionId", "=", input.registrationSurveyVersionId)
    .forUpdate()
    .executeTakeFirst();
  return assignment?.status === "completed" || assignment?.status === "waived";
}
