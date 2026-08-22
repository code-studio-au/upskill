import { Badge } from "#/features/shared/Badge";
import {
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PurchaseCourseButton } from "#/features/checkout/PurchaseCourseButton";
import { getCourse } from "#/server/functions/catalog";
import { topicLabel } from "#/features/shared/offering-topic";
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
        <Stack gap="md" className={classes.hero}>
          {course.coverImage ? (
            <img
              alt={course.coverImage.altText}
              className={classes.coverImage}
              decoding="async"
              src={`/api/catalog/courses/${encodeURIComponent(course.slug)}/cover-images/${encodeURIComponent(course.coverImage.assetId)}`}
            />
          ) : null}
          <Group gap="sm" className={classes.facts}>
            <Badge variant="light">{topicLabel(course.topic)}</Badge>
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

        <aside aria-label="Course enrolment" className={classes.enrolment}>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.purchaseCard}
          >
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
              {course.bulkPricing.enabled ? (
                <Link
                  to="/courses/$slug/bulk-order"
                  params={{ slug: course.slug }}
                  className={classes.bulkLink}
                >
                  <Button
                    component="span"
                    variant="default"
                    size="lg"
                    fullWidth
                  >
                    Purchase bulk access
                  </Button>
                </Link>
              ) : null}
              {course.hasCompletionCertificate ? (
                <Text size="sm" c="dimmed" className={classes.inclusion}>
                  <span aria-hidden="true">✓</span>
                  Downloadable completion certificate
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </aside>

        <Stack gap="xl" className={classes.details}>
          <section aria-labelledby="course-overview-heading">
            <Stack gap="sm">
              <Title order={2} id="course-overview-heading">
                About this course
              </Title>
              <Text className={classes.description}>{course.description}</Text>
            </Stack>
          </section>

          <hr className={classes.divider} />

          <section aria-labelledby="course-modules-heading">
            <Stack gap="md">
              <Title order={2} id="course-modules-heading">
                Course outline
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
              {course.accreditations.length === 0 ? null : (
                <div className={classes.accreditations}>
                  <Title order={3}>Accreditations</Title>
                  <div className={classes.accreditationList}>
                    {course.accreditations.map((accreditation, index) => (
                      <Paper
                        withBorder
                        radius="md"
                        p="md"
                        key={`${accreditation.name}-${String(index)}`}
                      >
                        <div className={classes.accreditation}>
                          {accreditation.logoAssetId ? (
                            <img
                              alt={accreditation.logoName}
                              className={classes.accreditationLogo}
                              decoding="async"
                              loading="lazy"
                              src={`/api/catalog/courses/${encodeURIComponent(course.slug)}/accreditation-logos/${encodeURIComponent(accreditation.logoAssetId)}`}
                            />
                          ) : null}
                          <Stack gap={4}>
                            <Text fw={700}>{accreditation.name}</Text>
                            {accreditation.cpdPoints === null ? null : (
                              <Text size="sm" c="indigo.7" fw={600}>
                                {accreditation.cpdPoints} CPD{" "}
                                {accreditation.cpdPoints === 1
                                  ? "point"
                                  : "points"}
                              </Text>
                            )}
                            {accreditation.blurb ? (
                              <Text size="sm" c="dimmed">
                                {accreditation.blurb}
                              </Text>
                            ) : null}
                          </Stack>
                        </div>
                      </Paper>
                    ))}
                  </div>
                </div>
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
        </Stack>
      </div>
    </Container>
  );
}
