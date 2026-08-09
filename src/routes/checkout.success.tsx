import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { checkoutSessionSearchSchema } from "#/features/checkout/checkout.schema";
import { getCourseCheckoutStatus } from "#/server/functions/checkout";
import classes from "./checkout.success.module.css";

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
  const search = Route.useSearch();
  const isPaid = checkout.status === "paid";
  const isPending = checkout.status === "pending";

  return (
    <Container size="sm" className={classes.page}>
      <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
        <Stack gap="lg">
          <div>
            <Text c="indigo.7" fw={700}>
              Checkout status
            </Text>
            <Title order={1}>
              {isPaid
                ? "Your course is ready"
                : isPending
                  ? "Payment is processing"
                  : "Checkout was not completed"}
            </Title>
          </div>

          {isPaid ? (
            <Alert color="green" title="Enrolment confirmed" role="status">
              {checkout.courseTitle} is now available in your learning area.
            </Alert>
          ) : isPending ? (
            <Alert color="blue" title="Awaiting confirmation" role="status">
              Stripe has returned you to Upskill, but the signed payment
              confirmation has not arrived yet. You can safely check again.
            </Alert>
          ) : (
            <Alert color="red" title="No enrolment created" role="status">
              This checkout did not complete. You can return to the course and
              start a new checkout.
            </Alert>
          )}

          {isPaid ? (
            <Button component={Link} to="/dashboard" size="lg">
              Go to my learning
            </Button>
          ) : isPending ? (
            <Link
              to="/checkout/success"
              search={{ session_id: search.session_id }}
              reloadDocument
              className={classes.link}
            >
              <Button component="span" size="lg" fullWidth>
                Check payment status
              </Button>
            </Link>
          ) : (
            <Link
              to="/courses/$slug"
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
