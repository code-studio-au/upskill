import {
  Badge,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { getCourse } from "#/server/functions/catalog";

export const Route = createFileRoute("/courses/$slug")({
  ssr: true,
  loader: async ({ params }) => {
    const course = await getCourse({ data: { slug: params.slug } });
    if (!course) throw notFound();
    return course;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.title} — Upskill`
          : "Course — Upskill",
      },
    ],
  }),
  component: CourseDetail,
});

function CourseDetail() {
  const course = Route.useLoaderData();
  return (
    <Container size="sm" py={{ base: 48, sm: 80 }}>
      <Stack gap="xl">
        <Group>
          <Badge>{course.topic}</Badge>
          <Text c="dimmed">{course.durationMinutes} minutes</Text>
        </Group>
        <Title order={1}>{course.title}</Title>
        <Text size="xl" c="dimmed">
          {course.summary}
        </Text>
        <Button size="lg">
          Enrol for ${(course.priceCents / 100).toFixed(2)} AUD
        </Button>
      </Stack>
    </Container>
  );
}
