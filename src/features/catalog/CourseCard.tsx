import { Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { CourseSummary } from "./catalog.schema";
import classes from "./CourseCard.module.css";

export function CourseCard({ course }: { course: CourseSummary }) {
  const dollars = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(course.priceCents / 100);

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
          <Text fw={700}>{dollars}</Text>
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
