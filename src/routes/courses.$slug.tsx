import { Badge } from "#/features/shared/Badge";
import {
  Container,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PurchaseCourseButton } from "#/features/checkout/PurchaseCourseButton";
import { getCourse } from "#/server/functions/catalog";
import classes from "./courses.$slug.module.css";

const audCurrencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

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
      ...(loaderData
        ? [{ name: "description", content: loaderData.summary }]
        : []),
    ],
  }),
  component: CourseDetail,
});

function CourseDetail() {
  const course = Route.useLoaderData();
  const standardPrice = audCurrencyFormatter.format(course.priceCents / 100);
  const currentPrice = audCurrencyFormatter.format(
    (course.salePriceCents ?? course.priceCents) / 100,
  );

  return (
    <Container size="lg" className={classes.page}>
      <div className={classes.layout}>
        <Stack gap="xl" className={classes.content}>
          <Stack gap="md">
            <Group>
              <Badge variant="light">{course.topic}</Badge>
              <Text c="dimmed">{course.durationMinutes} minutes</Text>
              <Text c="dimmed">
                {course.sections.length > 0
                  ? `${String(course.sections.reduce((total, section) => total + section.items.length, 0))} learning items`
                  : `${String(course.modules.length)} modules`}
              </Text>
            </Group>
            <Title order={1} className={classes.title}>
              {course.title}
            </Title>
            <Text size="xl" c="dimmed" className={classes.summary}>
              {course.summary}
            </Text>
          </Stack>

          <section aria-labelledby="course-overview-heading">
            <Stack gap="sm">
              <Title order={2} id="course-overview-heading">
                About this course
              </Title>
              <Text className={classes.description}>{course.description}</Text>
            </Stack>
          </section>

          <Divider />

          <section aria-labelledby="course-modules-heading">
            <Stack gap="md">
              <Title order={2} id="course-modules-heading">
                What you will complete
              </Title>
              {course.sections.length > 0 ? (
                <Stack gap="lg">
                  {course.sections.map((section) => (
                    <div key={section.title}>
                      <Title order={3}>{section.title}</Title>
                      {section.description ? (
                        <Text c="dimmed" size="sm" mt={4}>
                          {section.description}
                        </Text>
                      ) : null}
                      <ol className={classes.moduleList}>
                        {section.items.map((item) => (
                          <li key={`${item.kind}-${item.title}`}>
                            <Group justify="space-between" align="start">
                              <div>
                                <Text fw={700}>{item.title}</Text>
                                <Text size="sm" c="dimmed">
                                  {item.required ? "Required" : "Optional"}
                                  {item.durationMinutes
                                    ? ` · ${String(item.durationMinutes)} minutes`
                                    : ""}
                                </Text>
                              </div>
                              <Badge variant="light">{item.kind}</Badge>
                            </Group>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </Stack>
              ) : (
                <ol className={classes.moduleList}>
                  {course.modules.map((module) => (
                    <li key={`${module.phase}-${module.title}`}>
                      <div>
                        <Text fw={700}>{module.title}</Text>
                        <Text size="sm" c="dimmed">
                          {module.phase.replaceAll("-", " ")} ·{" "}
                          {module.durationMinutes} minutes
                        </Text>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Stack>
          </section>

          {course.prerequisites.length === 0 ? null : (
            <section aria-labelledby="course-prerequisites-heading">
              <Stack gap="sm">
                <Title order={2} id="course-prerequisites-heading">
                  Prerequisites
                </Title>
                <ul className={classes.plainList}>
                  {course.prerequisites.map((prerequisite) => (
                    <li key={prerequisite}>{prerequisite}</li>
                  ))}
                </ul>
              </Stack>
            </section>
          )}

          {course.accreditations.length === 0 ? null : (
            <section aria-labelledby="course-accreditation-heading">
              <Stack gap="sm">
                <Title order={2} id="course-accreditation-heading">
                  Accreditation and CPD
                </Title>
                <ul className={classes.plainList}>
                  {course.accreditations.map((accreditation) => (
                    <li key={accreditation.name}>
                      {accreditation.name}
                      {accreditation.cpdPoints === null
                        ? ""
                        : ` — ${String(accreditation.cpdPoints)} CPD ${accreditation.cpdPoints === 1 ? "point" : "points"}`}
                    </li>
                  ))}
                </ul>
              </Stack>
            </section>
          )}
        </Stack>

        <aside aria-label="Course enrolment" className={classes.enrolment}>
          <Paper withBorder radius="lg" p="xl">
            <Stack gap="lg">
              <div>
                {course.salePriceCents === null ? null : (
                  <Text c="dimmed" td="line-through">
                    {standardPrice}
                  </Text>
                )}
                <Text fw={800} className={classes.price}>
                  {currentPrice}
                </Text>
                <Text size="sm" c="dimmed">
                  AUD, including applicable GST
                </Text>
              </div>
              <PurchaseCourseButton slug={course.slug} />
              {course.hasCompletionCertificate ? (
                <Text size="sm" c="dimmed">
                  Includes a downloadable completion certificate.
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </aside>
      </div>
    </Container>
  );
}
