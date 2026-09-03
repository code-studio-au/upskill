import { Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import { activateEnterpriseEventAccess } from "#/server/functions/enterprise-contract";
import type { EnterpriseEventAccessResult } from "./enterprise-contract.schema";
import { alreadyRegisteredEventDestination } from "./enterprise-event-navigation";

const subscribeToHydration = () => () => undefined;

export function EnterpriseEventAccessButton({
  access,
  slug,
}: {
  access: EnterpriseEventAccessResult;
  slug: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<"ready" | "unavailable">("ready");
  if (access.status !== "ready") {
    if (access.status !== "already-registered") return null;
    if (alreadyRegisteredEventDestination(access) === "my-events")
      return (
        <Link to="/my-events">
          <Button component="span" size="lg" fullWidth>
            View registration
          </Button>
        </Link>
      );
    return (
      <Link
        to="/my-events/$eventOccurrenceId"
        params={{ eventOccurrenceId: access.eventOccurrenceId }}
      >
        <Button component="span" size="lg" fullWidth>
          {access.registrationRequired ? "Continue registration" : "Open event"}
        </Button>
      </Link>
    );
  }
  async function register(): Promise<void> {
    setPending(true);
    try {
      const result = await activateEnterpriseEventAccess({ data: { slug } });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(`/events/${slug}`)}`,
        );
        return;
      }
      if (result.status === "registered") {
        window.location.assign(
          `/my-events/${encodeURIComponent(result.eventOccurrenceId)}`,
        );
        return;
      }
      if (result.status === "already-registered") {
        window.location.assign(
          alreadyRegisteredEventDestination(result) === "event"
            ? `/my-events/${encodeURIComponent(result.eventOccurrenceId)}`
            : "/my-events",
        );
        return;
      }
      setState("unavailable");
    } finally {
      setPending(false);
    }
  }
  return (
    <Stack gap="sm">
      <Alert color="green" title="Included in your organisation access">
        <Text size="sm">
          {access.organizationName} covers this event through{" "}
          {access.contractName}. Capacity and registration dates still apply.
        </Text>
      </Alert>
      {state === "unavailable" ? (
        <Alert color="red">This place is no longer available.</Alert>
      ) : null}
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={!hydrated}
        onClick={() => void register()}
      >
        Register with organisation access
      </Button>
    </Stack>
  );
}
