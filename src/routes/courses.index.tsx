import {
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lazy, Suspense } from "react";
import { CourseCard } from "#/features/catalog/CourseCard";
import {
  catalogSearchSchema,
  type CatalogSearch,
} from "#/features/catalog/catalog.schema";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { PageTabs } from "#/features/shared/PageTabs";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { topicLabel } from "#/features/shared/offering-topic";
import { searchCourses, searchEvents } from "#/server/functions/catalog";
import classes from "./courses.index.module.css";

export const Route = createFileRoute("/courses/")({
  validateSearch: catalogSearchSchema,
  loaderDeps: ({ search }) => search,
  ssr: true,
  loader: ({ deps }) =>
    (deps.offering ?? "courses") === "events"
      ? searchEvents({ data: deps }).then((result) => ({
          type: "events" as const,
          ...result,
        }))
      : searchCourses({ data: deps }).then((result) => ({
          type: "courses" as const,
          ...result,
        })),
  component: CourseCatalog,
});

function CourseCatalog() {
  const search = Route.useSearch();
  const result = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const [submittedFilters, setSubmittedFilters] = useState<CatalogSearch>();
  const offering = search.offering ?? "courses";
  useEffect(() => {
    if (submittedFilters) void navigate({ search: submittedFilters });
  }, [navigate, submittedFilters]);

  return (
    <div className={classes.page}>
      <Container size="lg" className={classes.section}>
        <Stack gap="xl">
          <div className={classes.heading}>
            <Text c="indigo.7" fw={700}>
              Learning catalogue
            </Text>
            <Title order={1}>Find your next skill</Title>
          </div>
          <PageTabs
            label="Learning type"
            value={offering}
            tabs={[
              { value: "courses", label: "Courses" },
              { value: "events", label: "Events" },
            ]}
            onChange={(value) => {
              void navigate({
                search: { ...search, offering: value, topic: "all", page: 1 },
              });
            }}
          />
          <form
            key={`${search.q}:${search.topic}`}
            className={classes.filters}
            action={(form) => {
              const filters = catalogSearchSchema.parse({
                q: form.get("q"),
                topic: form.get("topic"),
                page: 1,
                offering,
              });
              setSubmittedFilters(filters);
            }}
          >
            <MantineTextInput
              name="q"
              label="Search"
              defaultValue={search.q}
              maxLength={100}
            />
            <MantineNativeSelect
              name="topic"
              label="Topic"
              defaultValue={search.topic}
              data={[
                { value: "all", label: "All topics" },
                ...result.topics.map((topic) => ({
                  value: topic,
                  label: topicLabel(topic),
                })),
              ]}
            />
            <Button type="submit" loading={navigating}>
              Apply filters
            </Button>
          </form>
          {search.q || search.topic !== "all" ? (
            <Stack gap="xs">
              <Text size="sm" fw={700}>
                Current filters
              </Text>
              <Group gap="xs">
                {search.q ? (
                  <RemovableFilterChip
                    label="Search"
                    value={search.q}
                    onRemove={() => {
                      void navigate({
                        search: { ...search, q: "", page: 1 },
                      });
                    }}
                  />
                ) : null}
                {search.topic !== "all" ? (
                  <RemovableFilterChip
                    label="Topic"
                    value={
                      result.topics.find(
                        (topic) =>
                          topic.localeCompare(search.topic, "en-AU", {
                            sensitivity: "base",
                          }) === 0,
                      ) ?? search.topic
                    }
                    onRemove={() => {
                      void navigate({
                        search: { ...search, topic: "all", page: 1 },
                      });
                    }}
                  />
                ) : null}
              </Group>
            </Stack>
          ) : null}
          {(result.type === "courses" ? result.courses : result.events).length >
          0 ? (
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed" role="status">
                  Showing {(result.page - 1) * result.pageSize + 1}–
                  {Math.min(result.page * result.pageSize, result.total)} of{" "}
                  {result.total}{" "}
                  {result.type === "events"
                    ? result.total === 1
                      ? "event"
                      : "events"
                    : result.total === 1
                      ? "course"
                      : "courses"}
                </Text>
              </Group>
              <div className={classes.grid}>
                {result.type === "courses"
                  ? result.courses.map((course) => (
                      <CourseCard
                        course={course}
                        headingOrder={2}
                        key={course.slug}
                      />
                    ))
                  : result.events.map((event) => (
                      <Suspense
                        fallback={
                          <Paper withBorder radius="lg" p="xl">
                            <Text>Loading event…</Text>
                          </Paper>
                        }
                        key={event.slug}
                      >
                        <LazyEventCard event={event} />
                      </Suspense>
                    ))}
              </div>
              {result.total > result.pageSize ? (
                <Group justify="space-between" className={classes.pagination}>
                  {result.page > 1 ? (
                    <Link
                      to="/courses"
                      search={{ ...search, page: result.page - 1 }}
                      className={classes.paginationLink}
                    >
                      <Button component="span" variant="default">
                        Previous
                      </Button>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {result.page * result.pageSize < result.total ? (
                    <Link
                      to="/courses"
                      search={{ ...search, page: result.page + 1 }}
                      className={classes.paginationLink}
                    >
                      <Button component="span" variant="default">
                        Next
                      </Button>
                    </Link>
                  ) : null}
                </Group>
              ) : null}
            </Stack>
          ) : (
            <Paper withBorder radius="lg" p="xl" className={classes.emptyState}>
              <Text fw={700} role="status">
                No {offering === "events" ? "events" : "courses"} match these
                filters.
              </Text>
              <Link
                to="/courses"
                search={{ offering, q: "", topic: "all", page: 1 }}
                className={classes.paginationLink}
              >
                <Button component="span" variant="default">
                  Clear filters
                </Button>
              </Link>
            </Paper>
          )}
        </Stack>
      </Container>
    </div>
  );
}

const LazyEventCard = lazy(async () => {
  const module = await import("#/features/catalog/EventCard");
  return { default: module.EventCard };
});
