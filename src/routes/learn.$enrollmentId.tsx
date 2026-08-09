import {
  Badge,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import {
  learnerWorkspaceInputSchema,
  type LearnerWorkspaceModule,
  type LearningPhase,
} from "#/features/learning/learning.schema";
import { getLearnerWorkspace } from "#/server/functions/learner";
import classes from "./learn.$enrollmentId.module.css";

const phaseDetails: Record<
  LearningPhase,
  { label: string; description: string }
> = {
  "pre-learning": {
    label: "Before you begin",
    description: "Prepare for the core learning experience.",
  },
  content: {
    label: "Learning modules",
    description: "Work through the main course content in order.",
  },
  "post-learning": {
    label: "Put it into practice",
    description: "Consolidate and apply what you have learned.",
  },
  followup: {
    label: "Follow-up",
    description: "Return to reinforce and extend your learning.",
  },
};

const phaseOrder: Array<LearningPhase> = [
  "pre-learning",
  "content",
  "post-learning",
  "followup",
];

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const Route = createFileRoute("/learn/$enrollmentId")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = learnerWorkspaceInputSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const input = parsed.data;
    const result = await getLearnerWorkspace({ data: input });
    if (result.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: {
          redirect: `/learn/${encodeURIComponent(input.enrollmentId)}`,
        },
      });
    }
    if (result.status === "not-found") throw notFound();
    if (result.status === "expired" || result.status === "removed") {
      throw redirect({
        to: "/courses/$slug",
        params: { slug: result.courseSlug },
      });
    }
    return result.workspace;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.courseTitle} — My learning`
          : "Course workspace — Upskill",
      },
    ],
  }),
  component: LearnerWorkspacePage,
});

function LearnerWorkspacePage() {
  const workspace = Route.useLoaderData();
  const modulesByPhase = new Map<
    LearningPhase,
    Array<LearnerWorkspaceModule>
  >();
  for (const module of workspace.modules) {
    const modules = modulesByPhase.get(module.phase) ?? [];
    modules.push(module);
    modulesByPhase.set(module.phase, modules);
  }

  return (
    <Container size="lg" className={classes.page}>
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            Course workspace
          </Text>
          <Title order={1}>{workspace.courseTitle}</Title>
          <Text c="dimmed" mt="xs" maw={720}>
            {workspace.courseSummary}
          </Text>
        </div>

        <div className={classes.layout}>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.summary}
          >
            <Stack gap="md">
              <Badge
                color={
                  workspace.completionStatus === "completed" ? "green" : "blue"
                }
                variant="light"
                w="fit-content"
              >
                {workspace.completionStatus === "completed"
                  ? "Completed"
                  : "In progress"}
              </Badge>
              <div>
                <Text size="sm" c="dimmed">
                  Enrolled
                </Text>
                <Text fw={600}>
                  {dateFormatter.format(new Date(workspace.enrolledAt))}
                </Text>
              </div>
              {workspace.expiresAt ? (
                <div>
                  <Text size="sm" c="dimmed">
                    Access until
                  </Text>
                  <Text fw={600}>
                    {dateFormatter.format(new Date(workspace.expiresAt))}
                  </Text>
                </div>
              ) : null}
              <Button component={Link} to="/dashboard" variant="light">
                Back to my learning
              </Button>
            </Stack>
          </Paper>

          <Stack gap="xl">
            <div>
              <Title order={2}>Course program</Title>
              <Text c="dimmed" mt={4}>
                Your enrolment gives you access to this exact published course
                version.
              </Text>
            </div>

            {phaseOrder.map((phase) => {
              const modules = modulesByPhase.get(phase);
              if (!modules || modules.length === 0) return null;
              const detail = phaseDetails[phase];
              return (
                <section key={phase} aria-labelledby={`phase-${phase}`}>
                  <Stack gap="sm">
                    <div>
                      <Title order={3} id={`phase-${phase}`}>
                        {detail.label}
                      </Title>
                      <Text c="dimmed" size="sm">
                        {detail.description}
                      </Text>
                    </div>
                    <ol className={classes.moduleList}>
                      {modules.map((module) => (
                        <li className={classes.module} key={module.position}>
                          <span className={classes.moduleNumber}>
                            {module.position + 1}
                          </span>
                          <Text fw={600}>{module.title}</Text>
                          <Badge
                            color={
                              module.completionState === "completed"
                                ? "green"
                                : "blue"
                            }
                            variant="light"
                            className={classes.moduleStatus}
                          >
                            {module.completionState === "completed"
                              ? "Completed"
                              : "In progress"}
                          </Badge>
                          <Text
                            size="sm"
                            c="dimmed"
                            className={classes.duration}
                          >
                            {module.durationMinutes} min
                          </Text>
                        </li>
                      ))}
                    </ol>
                  </Stack>
                </section>
              );
            })}
          </Stack>
        </div>
      </Stack>
    </Container>
  );
}
