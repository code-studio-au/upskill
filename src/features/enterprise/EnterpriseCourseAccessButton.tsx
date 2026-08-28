import { Link, useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import type { EnterpriseCourseAccessResult } from "./enterprise-contract.schema";
import { activateEnterpriseCourseAccess } from "#/server/functions/enterprise-contract";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";

const subscribeToHydration = () => () => undefined;

export function EnterpriseCourseAccessButton({
  access,
  slug,
}: {
  access: EnterpriseCourseAccessResult;
  slug: string;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<
    "ready" | "enrolled" | "already" | "unavailable"
  >(access.status === "already-enrolled" ? "already" : "ready");

  if (access.status !== "ready") {
    if (state !== "already") return null;
    return (
      <Stack gap="sm">
        <Alert color="blue">
          This course is already in your learning area.
        </Alert>
        <Button component={Link} to="/dashboard">
          Continue learning
        </Button>
      </Stack>
    );
  }

  async function enroll(): Promise<void> {
    setPending(true);
    try {
      const result = await activateEnterpriseCourseAccess({ data: { slug } });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(`/courses/${slug}`)}`,
        );
        return;
      }
      if (result.status === "enrolled") {
        setState("enrolled");
        await router.invalidate();
      } else if (result.status === "already-enrolled") setState("already");
      else setState("unavailable");
    } catch {
      setState("unavailable");
    } finally {
      setPending(false);
    }
  }

  if (state === "enrolled" || state === "already")
    return (
      <Stack gap="sm">
        <Alert color="green">
          {state === "enrolled"
            ? "Organisation access applied. This course is now in your learning area."
            : "This course is already in your learning area."}
        </Alert>
        <Button component={Link} to="/dashboard">
          Go to learning
        </Button>
      </Stack>
    );

  return (
    <Stack gap="sm">
      <Alert color="green" title="Included in your organisation access">
        <Text size="sm">
          {access.organizationName} provides this course through{" "}
          {access.contractName}. No payment is required.
        </Text>
      </Alert>
      {state === "unavailable" ? (
        <Alert color="red">
          Organisation enrolment is temporarily unavailable. Refresh and try
          again.
        </Alert>
      ) : null}
      <Button
        size="lg"
        loading={pending}
        disabled={!hydrated}
        onClick={() => void enroll()}
      >
        Enrol with organisation access
      </Button>
    </Stack>
  );
}
