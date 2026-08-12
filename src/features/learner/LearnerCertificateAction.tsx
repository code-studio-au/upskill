import { Button } from "#/features/shared/mantine";
import type { LearnerCourse } from "./learner.schema";

export function LearnerCertificateAction({
  certificate,
}: {
  certificate: NonNullable<LearnerCourse["certificate"]>;
}) {
  return (
    <Button
      component="a"
      href={`/api/learning/certificates/${encodeURIComponent(certificate.enrollmentId)}`}
      variant="light"
      fullWidth
    >
      Download certificate
    </Button>
  );
}
