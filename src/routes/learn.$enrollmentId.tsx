import { Badge } from "#/features/shared/Badge";
import { formatLocalDate } from "#/features/shared/local-date";
import {
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { LearnerProgramSections } from "#/features/learning/LearnerProgramSections";
import { learnerWorkspaceInputSchema } from "#/features/learning/learning.schema";
import { getLearnerWorkspace } from "#/server/functions/learner";
import { LearnerRegistrationQuestionnaire } from "#/features/registration/LearnerRegistrationQuestionnaire";
import classes from "#/features/learning/LearnerWorkspaceLayout.module.css";

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
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? loaderData.status === "registration-required"
            ? `Registration — ${loaderData.questionnaire.offeringTitle}`
            : `${loaderData.workspace.courseTitle} — My learning`
          : "Course workspace — Upskill",
      },
    ],
  }),
  component: LearnerWorkspacePage,
});

function LearnerWorkspacePage() {
  const result = Route.useLoaderData();
  if (result.status === "registration-required")
    return (
      <LearnerRegistrationQuestionnaire questionnaire={result.questionnaire} />
    );
  const workspace = result.workspace;

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
                <Text fw={600}>{formatLocalDate(workspace.enrolledAt)}</Text>
              </div>
              {workspace.expiresAt ? (
                <div>
                  <Text size="sm" c="dimmed">
                    Access until
                  </Text>
                  <Text fw={600}>{formatLocalDate(workspace.expiresAt)}</Text>
                </div>
              ) : null}
              <Button component={Link} to="/dashboard" variant="light">
                Back to my learning
              </Button>
            </Stack>
          </Paper>

          <Stack gap="xl">
            <Title order={2}>Course program</Title>

            <LearnerProgramSections
              kind="course"
              enrollmentId={workspace.enrollmentId}
              sections={workspace.sections}
            />
          </Stack>
        </div>
      </Stack>
    </Container>
  );
}
