import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Badge } from "#/features/shared/Badge";
import {
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { topicLabel } from "#/features/shared/offering-topic";
import { PurchaseEventButton } from "#/features/checkout/PurchaseEventButton";
import { EnterpriseEventAccessButton } from "#/features/enterprise/EnterpriseEventAccessButton";
import { getEvent } from "#/server/functions/catalog";
import { getEnterpriseEventAccess } from "#/server/functions/enterprise-contract";
import classes from "./courses.$slug.module.css";

const audCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export const Route = createFileRoute("/events/$slug")({
  ssr: true,
  loader: async ({ params }) => {
    const [event, enterpriseAccess] = await Promise.all([
      getEvent({ data: { slug: params.slug } }),
      getEnterpriseEventAccess({ data: { slug: params.slug } }),
    ]);
    if (!event) throw notFound();
    return { event, enterpriseAccess };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.event.title} — Upskill`
          : "Event — Upskill",
      },
    ],
  }),
  component: EventDetailPage,
});

function EventDetailPage() {
  const { event, enterpriseAccess } = Route.useLoaderData();
  const currentPrice = event.salePriceCents ?? event.priceCents;
  return (
    <Container size="lg" className={classes.page}>
      <div className={classes.layout}>
        <Stack gap="md" className={classes.hero}>
          {event.coverImage ? (
            <img
              alt={event.coverImage.altText}
              className={classes.coverImage}
              src={`/api/catalog/events/${encodeURIComponent(event.slug)}/cover-images/${encodeURIComponent(event.coverImage.assetId)}`}
            />
          ) : null}
          <Group gap="sm" className={classes.facts}>
            <Badge variant="light">{topicLabel(event.topic)}</Badge>
            <Badge variant="light" color="gray">
              {event.deliveryMode === "virtual" ? "Virtual" : "In person"}
            </Badge>
            <Text c="dimmed">{event.remainingPlaces} places remaining</Text>
          </Group>
          <Title order={1} className={classes.title}>
            {event.title}
          </Title>
          <Text size="xl" c="dimmed" className={classes.summary}>
            {event.summary}
          </Text>
        </Stack>
        <aside aria-label="Event registration" className={classes.enrolment}>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.purchaseCard}
          >
            <Stack gap="lg">
              <div>
                <Text fw={800} size="xl">
                  {formatLocalDateTime(event.startsAt, {
                    timeZone: event.timezone,
                  })}
                </Text>
                <Text c="dimmed">{event.timezone.replaceAll("_", " ")}</Text>
              </div>
              {currentPrice === null ? null : (
                <div>
                  {event.salePriceCents !== null &&
                  event.priceCents !== null ? (
                    <Text c="dimmed" td="line-through">
                      {audCurrency.format(event.priceCents / 100)}
                    </Text>
                  ) : null}
                  <Text fw={800} className={classes.price}>
                    {audCurrency.format(currentPrice / 100)}
                  </Text>
                </div>
              )}
              {enterpriseAccess.status === "ready" ||
              enterpriseAccess.status === "already-registered" ? (
                <EnterpriseEventAccessButton
                  access={enterpriseAccess}
                  slug={event.slug}
                />
              ) : event.registrationMode === "paid_entry" ? (
                <PurchaseEventButton slug={event.slug} />
              ) : event.registrationMode === "open_entry" &&
                event.publicAccessReference ? (
                <Link
                  to="/event-access/$publicReference"
                  params={{ publicReference: event.publicAccessReference }}
                >
                  <Button component="span" size="lg" fullWidth>
                    Access event
                  </Button>
                </Link>
              ) : (
                <Button component={Link} to="/my-events" size="lg">
                  Register in My events
                </Button>
              )}
              {event.bulkPricing.enabled ? (
                <Link
                  to="/events/$slug/bulk-order"
                  params={{ slug: event.slug }}
                >
                  <Button
                    component="span"
                    variant="default"
                    size="lg"
                    fullWidth
                  >
                    Purchase bulk access
                  </Button>
                </Link>
              ) : null}
              {event.hasCompletionCertificate ? (
                <Text size="sm" c="dimmed">
                  ✓ Completion certificate included
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </aside>
        <Stack gap="xl" className={classes.details}>
          <section>
            <Title order={2}>About this event</Title>
            <Text className={classes.description}>{event.description}</Text>
          </section>
          <hr className={classes.divider} />
          <section>
            <Stack gap="md">
              <Title order={2}>Schedule</Title>
              {event.sessions.map((session) => (
                <Paper
                  withBorder
                  radius="md"
                  p="md"
                  key={`${session.title}-${session.startsAt}`}
                >
                  <Text fw={700}>{session.title}</Text>
                  <Text size="sm" c="dimmed">
                    {formatLocalDateTime(session.startsAt, {
                      timeZone: event.timezone,
                    })}{" "}
                    –{" "}
                    {formatLocalDateTime(session.endsAt, {
                      timeZone: event.timezone,
                    })}
                  </Text>
                </Paper>
              ))}
            </Stack>
          </section>
          {event.regions.length ? (
            <section>
              <Title order={2}>Available regions</Title>
              <Text>
                {event.regions.map((region) => region.name).join(", ")}
              </Text>
            </section>
          ) : null}
          {event.accreditations.length ? (
            <section>
              <Stack gap="md">
                <Title order={2}>Accreditations</Title>
                {event.accreditations.map((item) => (
                  <Paper withBorder radius="md" p="md" key={item.name}>
                    <Group align="start" wrap="nowrap">
                      {item.logoAssetId ? (
                        <img
                          alt={item.logoName}
                          className={classes.accreditationLogo}
                          src={`/api/catalog/events/${encodeURIComponent(event.slug)}/accreditation-logos/${encodeURIComponent(item.logoAssetId)}`}
                        />
                      ) : null}
                      <div>
                        <Text fw={700}>{item.name}</Text>
                        {item.cpdPoints !== null ? (
                          <Text>{item.cpdPoints} CPD points</Text>
                        ) : null}
                        <Text c="dimmed" size="sm">
                          {item.blurb}
                        </Text>
                      </div>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </section>
          ) : null}
        </Stack>
      </div>
    </Container>
  );
}
