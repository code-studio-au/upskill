import { Badge } from "#/features/shared/Badge";
import { formatLocalDate } from "#/features/shared/local-date";
import { Button, Container, Paper, Stack, Text, Title } from "@mantine/core";
import { MantineProgress } from "#/features/shared/MantineProgress";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import {
  learnerWorkspaceInputSchema,
  type LearnerWorkspaceItem,
} from "#/features/learning/learning.schema";
import { getLearnerWorkspace } from "#/server/functions/learner";
import classes from "./learn.$enrollmentId.module.css";

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
            <div>
              <Title order={2}>Course program</Title>
              <Text c="dimmed" mt={4}>
                Your enrolment gives you access to this exact published course
                version.
              </Text>
            </div>

            {workspace.sections.map((section) => {
              const progress =
                section.totalItems === 0
                  ? 0
                  : (section.completedItems / section.totalItems) * 100;
              return (
                <section
                  key={section.id}
                  aria-labelledby={`section-${section.id}`}
                >
                  <Stack gap="sm">
                    <div className={classes.sectionHeading}>
                      <div>
                        <Title order={3} id={`section-${section.id}`}>
                          {section.title}
                        </Title>
                        {section.description ? (
                          <Text c="dimmed" size="sm">
                            {section.description}
                          </Text>
                        ) : null}
                      </div>
                      <Badge
                        color={
                          section.completionState === "completed"
                            ? "green"
                            : "blue"
                        }
                        variant="light"
                      >
                        {section.completionState === "completed"
                          ? "Section completed"
                          : `${String(section.completedItems)} of ${String(section.totalItems)}`}
                      </Badge>
                    </div>
                    <MantineProgress
                      value={progress}
                      color={
                        section.completionState === "completed"
                          ? "green"
                          : "indigo"
                      }
                      aria-label={`${section.title} progress`}
                    />
                    <ol className={classes.moduleList}>
                      {section.items.map((item) => (
                        <li className={classes.module} key={item.id}>
                          <div>
                            <Text fw={600}>{item.title}</Text>
                            <Text size="xs" c="dimmed" tt="capitalize">
                              {item.kind}
                              {!item.required ? " · Optional" : ""}
                              {item.durationMinutes
                                ? ` · ${String(item.durationMinutes)} min`
                                : ""}
                            </Text>
                          </div>
                          <Badge
                            color={
                              item.completionState === "completed"
                                ? "green"
                                : "blue"
                            }
                            variant="light"
                            className={classes.moduleStatus}
                          >
                            {item.completionState === "completed"
                              ? "Completed"
                              : "Not completed"}
                          </Badge>
                          <ItemAction
                            item={item}
                            enrollmentId={workspace.enrollmentId}
                          />
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

function ItemAction({
  item,
  enrollmentId,
}: {
  item: LearnerWorkspaceItem;
  enrollmentId: string;
}) {
  const router = useRouter();
  const [launchStatus, setLaunchStatus] = useState<0 | 1 | 2>(0);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const refreshSoon = () => {
    window.setTimeout(() => void router.invalidate(), 750);
  };

  if (item.kind === "resource" && item.resourceVersionId)
    return (
      <Button
        component="a"
        href={`/api/learning/resources/${encodeURIComponent(item.resourceVersionId)}?enrollmentId=${encodeURIComponent(enrollmentId)}`}
        target="_blank"
        rel="noreferrer"
        variant="light"
        size="xs"
        onClick={refreshSoon}
      >
        Open PDF
      </Button>
    );

  if (item.kind === "survey")
    return (
      <Link
        to="/learn/$enrollmentId/surveys/$courseVersionItemId"
        params={{
          enrollmentId,
          courseVersionItemId: item.id,
        }}
      >
        <Button component="span" variant="light" size="xs">
          {item.completionState === "completed"
            ? "View receipt"
            : "Complete survey"}
        </Button>
      </Link>
    );

  if (item.kind === "scorm" && item.modulePosition !== null)
    return (
      <div className={classes.itemAction}>
        <Button
          size="xs"
          loading={launchStatus === 1}
          onClick={(event) => {
            if (launchUrl) return void document.exitFullscreen();
            const player = event.currentTarget.parentElement;
            if (!player) return;
            player.onfullscreenchange = () => {
              if (!document.fullscreenElement) {
                setLaunchUrl(null);
                refreshSoon();
              }
            };
            setLaunchStatus(1);
            void player
              .requestFullscreen()
              .then(() =>
                fetch("/api/scorm/launches", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    enrollmentId,
                    modulePosition: item.modulePosition,
                  }),
                }),
              )
              .then(async (response) => {
                const result = (await response.json()) as {
                  launchUrl?: string;
                };
                if (!response.ok || !result.launchUrl) throw Error();
                setLaunchUrl(result.launchUrl);
                setLaunchStatus(0);
              })
              .catch(() => {
                setLaunchStatus(2);
              });
          }}
        >
          {launchUrl
            ? "Click here to exit"
            : launchStatus === 2
              ? "Retry"
              : "Launch"}
        </Button>
        {launchUrl ? (
          <iframe
            className={classes.playerFrame}
            src={launchUrl}
            title={item.title}
            sandbox="allow-same-origin allow-scripts"
            onLoad={() => void router.invalidate()}
          />
        ) : null}
      </div>
    );

  return (
    <Button size="xs" variant="light" disabled>
      Coming soon
    </Button>
  );
}
