import { Alert, Button, Stack } from "#/features/shared/mantine";
import { Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { startEventCheckout } from "#/server/functions/checkout";

const subscribeToHydration = () => () => undefined;

export function PurchaseEventButton({ slug }: { slug: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    "already-registered" | "unavailable" | null
  >(null);
  async function start(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const result = await startEventCheckout({ data: { slug } });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(`/events/${slug}`)}`,
        );
      } else if (result.status === "redirect") {
        window.location.assign(result.url);
      } else setMessage(result.status);
    } catch {
      setMessage("unavailable");
    } finally {
      setPending(false);
    }
  }
  if (message === "already-registered")
    return (
      <Stack gap="sm">
        <Alert color="blue">You are already registered.</Alert>
        <Button component={Link} to="/my-events">
          Go to my events
        </Button>
      </Stack>
    );
  return (
    <Stack gap="sm">
      {message === "unavailable" ? (
        <Alert color="red">
          Checkout could not be started. No payment has been taken.
        </Alert>
      ) : null}
      <Button
        size="lg"
        loading={pending}
        disabled={!hydrated}
        onClick={() => {
          void start();
        }}
      >
        Purchase event place
      </Button>
    </Stack>
  );
}
