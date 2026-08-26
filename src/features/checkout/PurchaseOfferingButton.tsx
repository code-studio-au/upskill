import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { Alert, Button, Stack } from "#/features/shared/mantine";
import type {
  CourseCheckoutResult,
  EventCheckoutResult,
} from "./checkout.schema";
import { preparePurchaseAccount } from "#/server/functions/checkout";

const AccountInviteDialog = lazy(async () => {
  const module = await import("#/features/shared/AccountInviteDialog");
  return { default: module.AccountInviteDialog };
});
const subscribeToHydration = () => () => undefined;
type CheckoutResult = CourseCheckoutResult | EventCheckoutResult;

export function PurchaseOfferingButton({
  accountPath,
  alreadyDestination,
  alreadyMessage,
  alreadyStatus,
  buttonLabel,
  offeringType,
  slug,
  startCheckout,
}: {
  accountPath: string;
  alreadyDestination: "/dashboard" | "/my-events";
  alreadyMessage: string;
  alreadyStatus: "already-enrolled" | "already-registered";
  buttonLabel: string;
  offeringType: "course" | "event";
  slug: string;
  startCheckout: () => Promise<CheckoutResult>;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    "account-setup" | "already" | "unavailable" | null
  >(null);
  const [creatingAccount, setCreatingAccount] = useState(false);

  async function start(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const result = await startCheckout();
      if (result.status === "unauthenticated") setCreatingAccount(true);
      else if (result.status === "redirect") window.location.assign(result.url);
      else
        setMessage(result.status === alreadyStatus ? "already" : "unavailable");
    } catch {
      setMessage("unavailable");
    } finally {
      setPending(false);
    }
  }

  if (message === "already")
    return (
      <Stack gap="sm">
        <Alert color="blue" role="status">
          {alreadyMessage}
        </Alert>
        <Button component={Link} to={alreadyDestination}>
          Continue
        </Button>
      </Stack>
    );

  return (
    <Stack gap="sm">
      {message === "unavailable" ? (
        <Alert color="red" role="alert">
          Checkout could not be started. No payment has been taken.
        </Alert>
      ) : null}
      {message === "account-setup" ? (
        <Alert color="green" title="Check your email" role="status">
          Follow the account-setup link, then return here to complete payment.
          If you already have an account, sign in instead.
        </Alert>
      ) : null}
      {message === "account-setup" ? (
        <Button
          component="a"
          href={`/login?redirect=${encodeURIComponent(accountPath)}`}
          variant="light"
        >
          Sign in
        </Button>
      ) : null}
      <Button
        size="lg"
        loading={pending}
        disabled={!hydrated}
        onClick={() => void start()}
      >
        {buttonLabel}
      </Button>
      {creatingAccount ? (
        <Suspense fallback={<LoadingSpinner label="Loading account setup" />}>
          <AccountInviteDialog
            title="Create your Upskill account"
            description="Enter your details to receive a secure account-setup link. After choosing a password, return here to complete payment."
            submitLabel="Email account setup"
            onClose={() => {
              setCreatingAccount(false);
            }}
            onInvite={async (input) => {
              const result = await preparePurchaseAccount({
                data: { ...input, offeringType, slug },
              });
              if (result.status !== "ready")
                return result.status === "rate-limited"
                  ? "Too many setup requests were made. Please wait before trying again."
                  : `This ${offeringType} is not currently available for purchase.`;
              setCreatingAccount(false);
              setMessage("account-setup");
              return null;
            }}
          />
        </Suspense>
      ) : null}
    </Stack>
  );
}
