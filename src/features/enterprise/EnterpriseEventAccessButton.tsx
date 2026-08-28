import { Link, useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import { activateEnterpriseEventAccess } from "#/server/functions/enterprise-contract";
import type { EnterpriseEventAccessResult } from "./enterprise-contract.schema";

const subscribeToHydration = () => () => undefined;

export function EnterpriseEventAccessButton({
  access,
  slug,
}: {
  access: EnterpriseEventAccessResult;
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
    "ready" | "registered" | "already" | "unavailable"
  >(access.status === "already-registered" ? "already" : "ready");
  if (access.status !== "ready") {
    if (state !== "already") return null;
    return (
      <Button component={Link} to="/my-events" size="lg" fullWidth>
        View in My events
      </Button>
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
        setState("registered");
        await router.invalidate();
      } else if (result.status === "already-registered") setState("already");
      else setState("unavailable");
    } finally {
      setPending(false);
    }
  }
  if (state === "registered" || state === "already")
    return (
      <Stack gap="sm">
        <Alert color="green">
          {state === "registered"
            ? "Organisation access applied. Your place is confirmed."
            : "You are already registered for this event."}
        </Alert>
        <Button component={Link} to="/my-events" size="lg" fullWidth>
          View in My events
        </Button>
      </Stack>
    );
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
