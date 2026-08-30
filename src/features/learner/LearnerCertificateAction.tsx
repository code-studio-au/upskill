import { Button } from "#/features/shared/mantine";
import type { LearnerCourse, LearnerEvent } from "./learner.schema";

export function LearnerCertificateAction({
  certificate,
}: {
  certificate:
    | NonNullable<LearnerCourse["certificate"]>
    | NonNullable<LearnerEvent["certificate"]>;
}) {
  const href =
    "enrollmentId" in certificate
      ? `/api/learning/certificates/${encodeURIComponent(certificate.enrollmentId)}`
      : `/api/learning/event-certificates/${encodeURIComponent(certificate.eventParticipationId)}`;
  return (
    <Button component="a" href={href} variant="light" fullWidth>
      Download certificate
    </Button>
  );
}
