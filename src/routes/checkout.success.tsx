import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { checkoutSessionSearchSchema } from "#/features/checkout/checkout.schema";
import { getCourseCheckoutStatus } from "#/server/functions/checkout";
import classes from "./checkout.success.module.css";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";

export const Route = createFileRoute("/checkout/success")({
  validateSearch: checkoutSessionSearchSchema,
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  ssr: true,
  loader: async ({ deps }) => {
    const result = await getCourseCheckoutStatus({
      data: { sessionId: deps.sessionId },
    });
    if (result.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: {
          redirect: `/checkout/success?session_id=${encodeURIComponent(deps.sessionId)}`,
        },
      });
    }
    if (result.status === "not-found") throw notFound();
    return result.checkout;
  },
  head: () => ({ meta: [{ title: "Checkout status — Upskill" }] }),
  component: CheckoutSuccessPage,
});

function CheckoutSuccessPage() {
  const checkout = Route.useLoaderData();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const isFulfilled =
    checkout.status === "paid" ||
    checkout.status === "partially_refunded" ||
    checkout.status === "refunded";
  const isPending = checkout.status === "pending";
  const isBulk = checkout.kind !== "individual_purchase";

  async function refreshStatus(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!isPending) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void router.invalidate().finally(() => {
        polling = false;
      });
    }, 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isPending, router]);

  return (
    <Container size="sm" className={classes.page}>
      <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
        <Stack gap="lg">
          <div>
            <Text c="indigo.7" fw={700}>
              Checkout status
            </Text>
            <Title order={1}>
              {isFulfilled
                ? isBulk
                  ? "Your access codes are ready"
                  : "Your course is ready"
                : isPending
                  ? "Payment is processing"
                  : "Checkout was not completed"}
            </Title>
          </div>

          {isFulfilled ? (
            <Alert color="green" title="Enrolment confirmed" role="status">
              {isBulk
                ? `Bulk access for ${checkout.courseTitle} is now available in Access management.`
                : `${checkout.courseTitle} is now available in your learning area.`}
            </Alert>
          ) : isPending ? (
            <Alert color="blue" title="Awaiting confirmation" role="status">
              <Group gap="sm" wrap="nowrap">
                <LoadingSpinner />
                <Text>
                  Stripe has returned you to Upskill, but the signed payment
                  confirmation has not arrived yet. This page updates
                  automatically.
                </Text>
              </Group>
            </Alert>
          ) : (
            <Alert color="red" title="No enrolment created" role="status">
              This checkout did not complete. You can return to the course and
              start a new checkout.
            </Alert>
          )}

          {isFulfilled ? (
            <Button
              component={Link}
              to={isBulk ? "/access-management" : "/dashboard"}
              size="lg"
            >
              {isBulk ? "Manage access" : "Go to my learning"}
            </Button>
          ) : isPending ? (
            <Button
              size="lg"
              fullWidth
              loading={refreshing}
              onClick={() => {
                void refreshStatus();
              }}
            >
              Check payment status
            </Button>
          ) : isBulk && checkout.kind === "capacity_extension" ? (
            <Link to="/access-management" className={classes.link}>
              <Button component="span" size="lg" fullWidth>
                Return to access management
              </Button>
            </Link>
          ) : (
            <Link
              to={isBulk ? "/courses/$slug/bulk-order" : "/courses/$slug"}
              params={{ slug: checkout.courseSlug }}
              className={classes.link}
            >
              <Button component="span" size="lg" fullWidth>
                Return to course
              </Button>
            </Link>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
