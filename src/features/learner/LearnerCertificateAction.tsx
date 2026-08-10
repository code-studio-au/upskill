import { Button } from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { LearnerCourse } from "./learner.schema";

export function LearnerCertificateAction({
  certificate,
}: {
  certificate: NonNullable<LearnerCourse["certificate"]>;
}) {
  const router = useRouter();
  useEffect(() => {
    if (certificate.status !== "pending") return;
    const timer = window.setInterval(() => void router.invalidate(), 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [certificate.status, router]);

  if (certificate.status === "pending")
    return (
      <Button variant="light" fullWidth loading disabled>
        Preparing certificate
      </Button>
    );
  return (
    <Button
      component="a"
      href={`/api/learning/certificates/${encodeURIComponent(certificate.id)}`}
      variant="light"
      fullWidth
    >
      Download certificate
    </Button>
  );
}
