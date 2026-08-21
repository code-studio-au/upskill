import { Badge } from "#/features/shared/Badge";
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { Link } from "@tanstack/react-router";
import type { CourseSummary } from "./catalog.schema";
import { topicLabel } from "#/features/shared/offering-topic";
import classes from "./CourseCard.module.css";

const audCurrencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function CourseCard({
  course,
  headingOrder = 3,
}: {
  course: CourseSummary;
  headingOrder?: 2 | 3;
}) {
  const standardPrice = audCurrencyFormatter.format(course.priceCents / 100);
  const currentPrice = audCurrencyFormatter.format(
    (course.salePriceCents ?? course.priceCents) / 100,
  );

  return (
    <Paper withBorder p="md" radius="lg" className={classes.card}>
      <Stack gap="sm" h="100%">
        {course.coverImage ? (
          <Link
            to="/courses/$slug"
            params={{ slug: course.slug }}
            className={classes.imageLink}
            tabIndex={-1}
            aria-hidden="true"
          >
            <img
              alt=""
              className={classes.image}
              decoding="async"
              loading="lazy"
              src={`/api/catalog/courses/${encodeURIComponent(course.slug)}/cover-images/${encodeURIComponent(course.coverImage.assetId)}`}
            />
          </Link>
        ) : null}
        <Group justify="space-between" align="flex-start">
          <Group gap="xs">
            <Badge variant="light">{topicLabel(course.topic)}</Badge>
            {course.salePriceCents === null ? null : (
              <Badge color="red" variant="light">
                Sale
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            <span className={classes.durationIcon} aria-hidden="true">
              ◷
            </span>{" "}
            {course.durationMinutes} min
          </Text>
        </Group>
        <Link
          to="/courses/$slug"
          params={{ slug: course.slug }}
          className={classes.titleLink}
        >
          <Title order={headingOrder}>{course.title}</Title>
        </Link>
        <Text c="dimmed" className={classes.summary}>
          {course.summary}
        </Text>
        <Group justify="space-between" className={classes.footer}>
          <Group gap="xs" className={classes.price}>
            {course.salePriceCents === null ? null : (
              <Text size="sm" c="dimmed" td="line-through">
                {standardPrice}
              </Text>
            )}
            <Text fw={700}>{currentPrice}</Text>
          </Group>
          <Link
            to="/courses/$slug"
            params={{ slug: course.slug }}
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
