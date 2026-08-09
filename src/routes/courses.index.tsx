import {
  Button,
  Container,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CourseCard } from "#/features/catalog/CourseCard";
import {
  catalogSearchSchema,
  type CatalogSearch,
} from "#/features/catalog/catalog.schema";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { searchCourses } from "#/server/functions/catalog";
import classes from "./courses.index.module.css";

export const Route = createFileRoute("/courses/")({
  validateSearch: catalogSearchSchema,
  loaderDeps: ({ search }) => search,
  ssr: true,
  loader: ({ deps }) => searchCourses({ data: deps }),
  component: CourseCatalog,
});

function CourseCatalog() {
  const search = Route.useSearch();
  const courses = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const [submittedFilters, setSubmittedFilters] = useState<CatalogSearch>();
  useEffect(() => {
    if (submittedFilters) void navigate({ search: submittedFilters });
  }, [navigate, submittedFilters]);

  return (
    <Container size="lg" className={classes.section}>
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            Course catalogue
          </Text>
          <Title order={1}>Find your next skill</Title>
        </div>
        <form
          key={`${search.q}:${search.topic}`}
          className={classes.filters}
          action={(form) => {
            const filters = catalogSearchSchema.parse({
              q: form.get("q"),
              topic: form.get("topic"),
              page: 1,
            });
            setSubmittedFilters(filters);
          }}
        >
          <TextInput
            name="q"
            label="Search"
            defaultValue={search.q}
            maxLength={100}
          />
          <NativeSelect
            name="topic"
            label="Topic"
            defaultValue={search.topic}
            data={[
              { value: "all", label: "All topics" },
              { value: "leadership", label: "Leadership" },
              { value: "safety", label: "Safety" },
              { value: "technology", label: "Technology" },
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
                      search: { q: "", topic: search.topic, page: 1 },
                    });
                  }}
                />
              ) : null}
              {search.topic !== "all" ? (
                <RemovableFilterChip
                  label="Topic"
                  value={
                    search.topic.charAt(0).toUpperCase() + search.topic.slice(1)
                  }
                  onRemove={() => {
                    void navigate({
                      search: { q: search.q, topic: "all", page: 1 },
                    });
                  }}
                />
              ) : null}
            </Group>
          </Stack>
        ) : null}
        {courses.length > 0 ? (
          <div className={classes.grid}>
            {courses.map((course) => (
              <CourseCard course={course} key={course.slug} />
            ))}
          </div>
        ) : (
          <Text role="status">No courses match these filters.</Text>
        )}
      </Stack>
    </Container>
  );
}
