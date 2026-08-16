import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Group, Paper, Stack, Text, Title } from "#/features/shared/mantine";
import { ProgressOverrideControls } from "#/features/admin/ProgressOverrideControls";
import type { AdminEnrollmentDetail } from "#/features/admin/admin.schema";
import classes from "./AdminEnrollmentProgressPanel.module.css";

export type AdminEnrollmentProgressView =
  "overview" | "modules" | "corrections";

function stateColour(state: "completed" | "incomplete"): string {
  return state === "completed" ? "green" : "blue";
}

function renderOverview(
  detail: AdminEnrollmentDetail,
  refresh: () => Promise<void>,
) {
  return (
    <>
      <section aria-labelledby="course-completion-heading">
        <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={2} id="course-completion-heading">
                  Overall course completion
                </Title>
              </div>
              <Badge
                color={stateColour(detail.enrollment.completionState)}
                variant="light"
              >
                {detail.enrollment.completionState}
              </Badge>
            </Group>
            <div className={classes.detailGrid}>
              <div>
                <Text size="sm" c="dimmed">
                  Enrolled
                </Text>
                <Text fw={600}>
                  {formatLocalDateTime(detail.enrollment.enrolledAt)}
                </Text>
              </div>
              <div>
                <Text size="sm" c="dimmed">
                  Completion source
                </Text>
                <Text fw={600}>{detail.enrollment.completionSource}</Text>
              </div>
              <div>
                <Text size="sm" c="dimmed">
                  Completed
                </Text>
                <Text fw={600}>
                  {detail.enrollment.completedAt
                    ? formatLocalDateTime(detail.enrollment.completedAt)
                    : "Not completed"}
                </Text>
              </div>
            </div>
            <ProgressOverrideControls
              enrollmentId={detail.enrollment.id}
              scope="enrollment"
              modulePosition={null}
              currentState={detail.enrollment.completionState}
              onChanged={refresh}
            />
          </Stack>
        </Paper>
      </section>

      {detail.sections.length > 0 ? (
        <section aria-labelledby="section-progress-heading">
          <Stack gap="md">
            <div>
              <Title order={2} id="section-progress-heading">
                Section progress
              </Title>
            </div>
            <div className={classes.moduleDetailList}>
              {detail.sections.map((section) => (
                <Paper
                  withBorder
                  radius="lg"
                  p={{ base: "lg", sm: "xl" }}
                  key={section.id}
                >
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Title order={3}>{section.title}</Title>
                        {section.description ? (
                          <Text c="dimmed" size="sm">
                            {section.description}
                          </Text>
                        ) : null}
                      </div>
                      <Badge color={stateColour(section.state)} variant="light">
                        {section.state}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {section.completedItems} of {section.totalItems} items
                      completed
                    </Text>
                    <Stack gap="xs">
                      {section.items.map((item) => (
                        <Group
                          key={item.id}
                          justify="space-between"
                          wrap="wrap"
                        >
                          <div>
                            <Text fw={600}>{item.title}</Text>
                            <Text size="xs" c="dimmed" tt="capitalize">
                              {item.kind} ·{" "}
                              {item.required ? "Required" : "Optional"}
                            </Text>
                          </div>
                          <Badge
                            color={stateColour(item.state)}
                            variant="light"
                          >
                            {item.state}
                          </Badge>
                        </Group>
                      ))}
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </div>
          </Stack>
        </section>
      ) : null}
    </>
  );
}

function renderModules(
  detail: AdminEnrollmentDetail,
  refresh: () => Promise<void>,
) {
  return (
    <section aria-labelledby="module-progress-heading">
      <Stack gap="md">
        <div>
          <Title order={2} id="module-progress-heading">
            Module progress
          </Title>
        </div>
        {detail.modules.length > 0 ? (
          <div className={classes.moduleDetailList}>
            {detail.modules.map((module) => (
              <Paper
                withBorder
                radius="lg"
                p={{ base: "lg", sm: "xl" }}
                key={module.position}
              >
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text size="sm" c="dimmed">
                        Module {module.position + 1} · {module.phase}
                      </Text>
                      <Title order={3}>{module.title}</Title>
                    </div>
                    <Badge color={stateColour(module.state)} variant="light">
                      {module.state}
                    </Badge>
                  </Group>
                  <div className={classes.detailGrid}>
                    <div>
                      <Text size="sm" c="dimmed">
                        Effective source
                      </Text>
                      <Text fw={600}>{module.source}</Text>
                    </div>
                    <div>
                      <Text size="sm" c="dimmed">
                        SCORM attempts
                      </Text>
                      <Text fw={600}>{module.attemptCount}</Text>
                    </div>
                    <div>
                      <Text size="sm" c="dimmed">
                        Latest activity
                      </Text>
                      <Text fw={600}>
                        {module.latestActivityAt
                          ? formatLocalDateTime(module.latestActivityAt)
                          : "No activity"}
                      </Text>
                    </div>
                  </div>
                  <ProgressOverrideControls
                    enrollmentId={detail.enrollment.id}
                    scope="module"
                    modulePosition={module.position}
                    currentState={module.state}
                    onChanged={refresh}
                  />
                </Stack>
              </Paper>
            ))}
          </div>
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>This course version has no mapped SCORM modules.</Text>
          </Paper>
        )}
      </Stack>
    </section>
  );
}

function renderCorrections(detail: AdminEnrollmentDetail) {
  return (
    <section aria-labelledby="override-history-heading">
      <Stack gap="md">
        <div>
          <Title order={2} id="override-history-heading">
            Correction history
          </Title>
        </div>
        {detail.overrideHistory.length > 0 ? (
          <ol className={classes.auditList}>
            {detail.overrideHistory.map((override) => (
              <li key={override.id}>
                <Paper withBorder radius="md" p="md">
                  <Text fw={600}>
                    {override.scope === "module"
                      ? `Module ${String((override.modulePosition ?? 0) + 1)}`
                      : "Overall course"}{" "}
                    marked {override.state}
                  </Text>
                  {override.reason ? (
                    <Text size="sm">{override.reason}</Text>
                  ) : null}
                  <Text size="xs" c="dimmed" mt={4}>
                    {override.administratorName} ·{" "}
                    {formatLocalDateTime(override.createdAt)}
                  </Text>
                </Paper>
              </li>
            ))}
          </ol>
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>No administrator corrections have been recorded.</Text>
          </Paper>
        )}
      </Stack>
    </section>
  );
}

export function AdminEnrollmentProgressPanel({
  detail,
  refresh,
  view,
}: {
  detail: AdminEnrollmentDetail;
  refresh: () => Promise<void>;
  view: AdminEnrollmentProgressView;
}) {
  if (view === "overview") return renderOverview(detail, refresh);
  if (view === "modules") return renderModules(detail, refresh);
  return renderCorrections(detail);
}
