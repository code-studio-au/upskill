import { Link } from "@tanstack/react-router";
import { Badge } from "#/features/shared/Badge";
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { topicLabel } from "#/features/shared/offering-topic";
import type { EventSummary } from "./catalog.schema";
import classes from "./CourseCard.module.css";

const audCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function EventCard({ event }: { event: EventSummary }) {
  const currentPrice = event.salePriceCents ?? event.priceCents;
  return (
    <Paper withBorder p="md" radius="lg" className={classes.card}>
      <Stack gap="sm" h="100%">
        {event.coverImage ? (
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            className={classes.imageLink}
            tabIndex={-1}
            aria-hidden="true"
          >
            <img
              alt=""
              className={classes.image}
              decoding="async"
              loading="lazy"
              src={`/api/catalog/events/${encodeURIComponent(event.slug)}/cover-images/${encodeURIComponent(event.coverImage.assetId)}`}
            />
          </Link>
        ) : null}
        <Group justify="space-between" align="flex-start">
          <Group gap="xs">
            <Badge variant="light">{topicLabel(event.topic)}</Badge>
            {event.featured ? <Badge variant="light">Featured</Badge> : null}
          </Group>
          <Badge variant="light" color="gray">
            {event.deliveryMode === "virtual" ? "Virtual" : "In person"}
          </Badge>
        </Group>
        <Link
          to="/events/$slug"
          params={{ slug: event.slug }}
          className={classes.titleLink}
        >
          <Title order={2}>{event.title}</Title>
        </Link>
        <Text fw={600} size="sm">
          {formatLocalDateTime(event.startsAt, { timeZone: event.timezone })}
        </Text>
        <Text c="dimmed" className={classes.summary}>
          {event.summary}
        </Text>
        <Group justify="space-between" className={classes.footer}>
          <Text fw={700}>
            {currentPrice === null
              ? "Registration"
              : audCurrency.format(currentPrice / 100)}
          </Text>
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            className={classes.link}
          >
            <Button
              component="span"
              rightSection={<span aria-hidden="true">→</span>}
            >
              View details
            </Button>
          </Link>
        </Group>
      </Stack>
    </Paper>
  );
}
