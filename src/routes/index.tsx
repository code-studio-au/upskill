import {
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CourseCard } from "#/features/catalog/CourseCard";
import { getFeaturedCourses } from "#/server/functions/catalog";
import classes from "./index.module.css";

export const Route = createFileRoute("/")({
  ssr: true,
  loader: () => getFeaturedCourses(),
  head: () => ({ meta: [{ title: "Upskill — learning that moves with you" }] }),
  component: HomePage,
});

function HomePage() {
  const courses = Route.useLoaderData();
  return (
    <>
      <section className={classes.hero}>
        <Container size="lg" className={classes.heroGrid}>
          <Stack gap="xl">
            <Text fw={800} c="indigo.7" className={classes.eyebrow}>
              Learn with confidence
            </Text>
            <Title order={1} className={classes.title}>
              Skills that make work better.
            </Title>
            <Text size="xl" c="dimmed" className={classes.lead}>
              Practical, accessible learning for people and
              organisations—available wherever the work happens.
            </Text>
            <Group>
              <Button
                component={Link}
                to="/courses"
                size="lg"
                rightSection={<span aria-hidden="true">→</span>}
              >
                Explore courses
              </Button>
            </Group>
          </Stack>
          <Stack className={classes.featurePanel} gap="xl">
            <Group wrap="nowrap">
              <span className={classes.featureBadge}>
                <span className={classes.featureIcon} aria-hidden="true">
                  ↗
                </span>
              </span>
              <Text fw={700}>Learn on any screen</Text>
            </Group>
            <Group wrap="nowrap">
              <span className={classes.featureBadge}>
                <span className={classes.featureIcon} aria-hidden="true">
                  ✓
                </span>
              </span>
              <Text fw={700}>Private and secure</Text>
            </Group>
            <Group wrap="nowrap">
              <span className={classes.featureBadge}>
                <span className={classes.featureIcon} aria-hidden="true">
                  ★
                </span>
              </span>
              <Text fw={700}>Verified certificates</Text>
            </Group>
          </Stack>
        </Container>
      </section>
      <section className={classes.courses}>
        <Container size="lg">
          <Stack gap="xl">
            <div>
              <Text c="indigo.7" fw={700}>
                Featured learning
              </Text>
              <Title order={2}>Start with something useful</Title>
            </div>
            <div className={classes.cardGrid}>
              {courses.map((course) => (
                <CourseCard course={course} key={course.slug} />
              ))}
            </div>
          </Stack>
        </Container>
      </section>
    </>
  );
}
