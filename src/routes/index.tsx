import { Button, Container, Text, Title } from "#/features/shared/mantine";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CourseCard } from "#/features/catalog/CourseCard";
import { getFeaturedCourses } from "#/server/functions/catalog";
import classes from "./index.module.css";

export const Route = createFileRoute("/")({
  ssr: true,
  loader: () => getFeaturedCourses(),
  head: () => ({
    meta: [
      { title: "Upskill Institute — skills that make work better" },
      {
        name: "description",
        content:
          "Trusted, practical learning for health and human services professionals.",
      },
    ],
  }),
  component: HomePage,
});

type HomeIconName =
  "book" | "certificate" | "device" | "learners" | "lock" | "rating" | "shield";

function HomeIcon({ name }: { name: HomeIconName }) {
  return (
    <svg
      aria-hidden="true"
      className={classes.lineIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <use href={`/brand/home-icons.svg#${name}`} />
    </svg>
  );
}

const featureItems = [
  {
    icon: "device" as const,
    title: "Learn on any screen",
    copy: "Study on your schedule, on any device.",
  },
  {
    icon: "lock" as const,
    title: "Private and secure",
    copy: "Your data is protected, always.",
  },
  {
    icon: "certificate" as const,
    title: "Verified certificates",
    copy: "Share your achievements with confidence.",
  },
];

const proofItems = [
  { icon: "learners" as const, value: "25,000+", label: "Learners worldwide" },
  { icon: "book" as const, value: "120+", label: "Expert-led courses" },
  { icon: "rating" as const, value: "4.8/5", label: "Learner rating" },
  { icon: "shield" as const, value: "CPD", label: "Accredited learning" },
];

function HomePage() {
  const courses = Route.useLoaderData();
  return (
    <div className={classes.page}>
      <section className={classes.hero}>
        <Container size="xl" className={classes.heroInner}>
          <div className={classes.heroGrid}>
            <div className={classes.heroCopy}>
              <Title order={1} className={classes.title}>
                Skills that make work better.
              </Title>
              <Text className={classes.introduction}>
                Trusted, practical learning for health and human services
                professionals. Learn anytime, anywhere with confidence.
              </Text>
              <div className={classes.heroActions}>
                <Button
                  component={Link}
                  to="/courses"
                  size="lg"
                  className={classes.primaryAction}
                  rightSection={<span aria-hidden="true">→</span>}
                >
                  Explore courses
                </Button>
                <a href="#why-upskill" className={classes.secondaryAction}>
                  How it works <span aria-hidden="true">›</span>
                </a>
              </div>
            </div>

            <div className={classes.featurePanel} id="why-upskill">
              {featureItems.map((item) => (
                <div className={classes.featureItem} key={item.title}>
                  <span className={classes.featureBadge}>
                    <HomeIcon name={item.icon} />
                  </span>
                  <span className={classes.featureCopy}>
                    <strong>{item.title}</strong>
                    <span>{item.copy}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={classes.proofBar} aria-label="Upskill at a glance">
            {proofItems.map((item) => (
              <div className={classes.proofItem} key={item.label}>
                <HomeIcon name={item.icon} />
                <span>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className={classes.courses}>
        <Container size="xl">
          <div className={classes.sectionHeader}>
            <div>
              <Text className={classes.sectionEyebrow}>Featured learning</Text>
              <Title order={2}>Start with something useful</Title>
            </div>
            <Link
              to="/courses"
              search={{ q: "", topic: "all", page: 1 }}
              className={classes.viewAllLink}
            >
              View all courses <span aria-hidden="true">→</span>
            </Link>
          </div>
          {courses.length > 0 ? (
            <div className={classes.cardGrid}>
              {courses.map((course) => (
                <CourseCard course={course} key={course.slug} />
              ))}
            </div>
          ) : (
            <div className={classes.emptyCourses}>
              <Text fw={700}>Featured courses are coming soon.</Text>
              <Link to="/courses" search={{ q: "", topic: "all", page: 1 }}>
                Browse all learning
              </Link>
            </div>
          )}
        </Container>
      </section>
    </div>
  );
}
