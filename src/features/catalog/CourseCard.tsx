import { Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { CourseSummary } from "./catalog.schema";
import classes from "./CourseCard.module.css";

const audCurrencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function CourseCard({ course }: { course: CourseSummary }) {
  const standardPrice = audCurrencyFormatter.format(course.priceCents / 100);
  const currentPrice = audCurrencyFormatter.format(
    (course.salePriceCents ?? course.priceCents) / 100,
  );

  return (
    <Card withBorder padding="lg" radius="lg" className={classes.card}>
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="flex-start">
          <Badge variant="light">{course.topic}</Badge>
          <Text size="sm" c="dimmed">
            {course.durationMinutes} min
          </Text>
        </Group>
        <Title order={3}>{course.title}</Title>
        <Text c="dimmed" className={classes.summary}>
          {course.summary}
        </Text>
        <Group justify="space-between">
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
            <Button component="span">View course</Button>
          </Link>
        </Group>
      </Stack>
    </Card>
  );
}
