import { Alert, Button, Stack } from "#/features/shared/mantine";
import { Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { startCourseCheckout } from "#/server/functions/checkout";

const subscribeToHydration = () => () => undefined;

export function PurchaseCourseButton({ slug }: { slug: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    "already-enrolled" | "unavailable" | null
  >(null);

  async function startCheckout(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const result = await startCourseCheckout({ data: { slug } });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(`/courses/${slug}`)}`,
        );
        return;
      }
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setMessage(result.status);
    } catch {
      setMessage("unavailable");
    } finally {
      setPending(false);
    }
  }

  if (message === "already-enrolled") {
    return (
      <Stack gap="sm">
        <Alert color="blue" title="Already enrolled" role="status">
          This course is already in your learning area.
        </Alert>
        <Button component={Link} to="/dashboard" size="lg">
          Go to my learning
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {message === "unavailable" ? (
        <Alert color="red" title="Checkout unavailable" role="alert">
          We could not start checkout. No payment has been taken; please try
          again.
        </Alert>
      ) : null}
      <Button
        size="lg"
        loading={pending}
        disabled={!hydrated}
        onClick={() => {
          void startCheckout();
        }}
      >
        Enrol in this course
      </Button>
    </Stack>
  );
}
