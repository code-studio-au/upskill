import {
  Button,
  Container,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CourseCard } from "#/features/catalog/CourseCard";
import { catalogSearchSchema } from "#/features/catalog/catalog.schema";
import { searchCourses } from "#/server/functions/catalog";
import classes from "./courses.index.module.css";

export const Route = createFileRoute("/courses/")({
  ssr: true,
  validateSearch: catalogSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => searchCourses({ data: deps }),
  component: CourseCatalog,
});

function CourseCatalog() {
  const search = Route.useSearch();
  const courses = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const [query, setQuery] = useState(search.q);
  const [topic, setTopic] = useState(search.topic);

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
          className={classes.filters}
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({ search: { q: query, topic, page: 1 } });
          }}
        >
          <TextInput
            label="Search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <NativeSelect
            label="Topic"
            value={topic}
            onChange={(event) =>
              setTopic(event.currentTarget.value as typeof topic)
            }
            data={[
              { value: "all", label: "All topics" },
              { value: "leadership", label: "Leadership" },
              { value: "safety", label: "Safety" },
              { value: "technology", label: "Technology" },
            ]}
          />
          <Button type="submit">Apply filters</Button>
        </form>
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
