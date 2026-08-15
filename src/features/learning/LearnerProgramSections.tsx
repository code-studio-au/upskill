import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type {
  LearnerEventWorkspaceItem,
  LearnerEventWorkspaceSection,
} from "#/features/learner/learner-event-workspace.schema";
import { LazyFullscreenScormLauncher } from "#/features/learning/LazyFullscreenScormLauncher";
import type {
  LearnerWorkspaceItem,
  LearnerWorkspaceSection,
} from "#/features/learning/learning.schema";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Stack, Text, Title } from "#/features/shared/mantine";
import { MantineProgress } from "#/features/shared/MantineProgress";
import classes from "./LearnerProgramSections.module.css";

type LearnerProgramProps =
  | {
      kind: "course";
      enrollmentId: string;
      sections: Array<LearnerWorkspaceSection>;
    }
  | {
      kind: "event";
      eventOccurrenceId: string;
      eventParticipationId: string;
      sections: Array<LearnerEventWorkspaceSection>;
      timezone: string;
    };

export function LearnerProgramSections(props: LearnerProgramProps) {
  const router = useRouter();
  const refreshSoon = () => {
    window.setTimeout(() => void router.invalidate(), 750);
  };
  return props.sections.map((section) => {
    const progress =
      section.totalItems === 0
        ? 0
        : (section.completedItems / section.totalItems) * 100;
    return (
      <section key={section.id} aria-labelledby={`section-${section.id}`}>
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
            <SectionStatus props={props} section={section} />
          </div>
          <MantineProgress
            value={progress}
            color={section.completionState === "completed" ? "green" : "indigo"}
            aria-label={`${section.title} progress`}
          />
          <ol className={classes.itemList}>
            {section.items.map((item) => (
              <li className={classes.item} key={item.id}>
                <ItemDescription props={props} item={item} />
                <Badge
                  color={
                    item.completionState === "completed" ? "green" : "blue"
                  }
                  variant="light"
                  className={classes.itemStatus}
                >
                  {item.completionState === "completed"
                    ? "Completed"
                    : "Not completed"}
                </Badge>
                {props.kind === "course" ? (
                  <CourseItemAction
                    item={item as LearnerWorkspaceItem}
                    enrollmentId={props.enrollmentId}
                    refreshSoon={refreshSoon}
                  />
                ) : (
                  <EventItemAction
                    item={item as LearnerEventWorkspaceItem}
                    available={section.completionState !== "locked"}
                    eventParticipationId={props.eventParticipationId}
                    eventOccurrenceId={props.eventOccurrenceId}
                    refreshSoon={refreshSoon}
                  />
                )}
              </li>
            ))}
          </ol>
        </Stack>
      </section>
    );
  });
}

function SectionStatus({
  props,
  section,
}: {
  props: LearnerProgramProps;
  section: LearnerWorkspaceSection | LearnerEventWorkspaceSection;
}) {
  const locked = section.completionState === "locked";
  const label = locked
    ? props.kind === "event" && "releaseAt" in section
      ? `Opens ${formatLocalDateTime(section.releaseAt, {
          timeZone: props.timezone,
        })}`
      : "Locked"
    : section.completionState === "completed"
      ? "Section completed"
      : `${String(section.completedItems)} of ${String(section.totalItems)}`;
  return (
    <Badge
      color={
        section.completionState === "completed"
          ? "green"
          : locked
            ? "gray"
            : "blue"
      }
      variant="light"
    >
      {label}
    </Badge>
  );
}

function ItemDescription({
  props,
  item,
}: {
  props: LearnerProgramProps;
  item: LearnerWorkspaceItem | LearnerEventWorkspaceItem;
}) {
  const eventItem =
    props.kind === "event" ? (item as LearnerEventWorkspaceItem) : null;
  return (
    <div>
      <Text fw={600}>{item.title}</Text>
      <Text size="xs" c="dimmed" tt="capitalize">
        {eventItem?.kind === "session" ? "Event session" : item.kind}
        {!item.required ? " · Optional" : ""}
        {item.durationMinutes ? ` · ${String(item.durationMinutes)} min` : ""}
      </Text>
      {eventItem?.session ? (
        <Text size="xs" c="dimmed" mt={4}>
          {formatLocalDateTime(eventItem.session.startsAt, {
            ...(props.kind === "event" ? { timeZone: props.timezone } : {}),
          })}
        </Text>
      ) : null}
    </div>
  );
}

function CourseItemAction({
  item,
  enrollmentId,
  refreshSoon,
}: {
  item: LearnerWorkspaceItem;
  enrollmentId: string;
  refreshSoon: () => void;
}): ReactNode {
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
        params={{ enrollmentId, courseVersionItemId: item.id }}
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
      <LazyFullscreenScormLauncher
        title={item.title}
        payload={{ enrollmentId, modulePosition: item.modulePosition }}
        onExit={refreshSoon}
      />
    );
  return (
    <Button size="xs" variant="light" disabled>
      Coming soon
    </Button>
  );
}

function EventItemAction({
  item,
  available,
  eventParticipationId,
  eventOccurrenceId,
  refreshSoon,
}: {
  item: LearnerEventWorkspaceItem;
  available: boolean;
  eventParticipationId: string;
  eventOccurrenceId: string;
  refreshSoon: () => void;
}): ReactNode {
  if (!available)
    return (
      <Button size="xs" variant="light" disabled>
        Locked
      </Button>
    );
  if (item.kind === "session" && item.session)
    return item.session.virtualJoinUrl ? (
      <Button
        component="a"
        href={item.session.virtualJoinUrl}
        target="_blank"
        rel="noreferrer"
        size="xs"
      >
        Join session
      </Button>
    ) : (
      <Button size="xs" variant="light" disabled>
        {item.session.attendanceState === "attended"
          ? "Attendance recorded"
          : "Not open yet"}
      </Button>
    );
  if (item.kind === "resource" && item.learningActivityVersionId)
    return (
      <Button
        component="a"
        href={`/api/learning/resources/${encodeURIComponent(item.learningActivityVersionId)}?eventParticipationId=${encodeURIComponent(eventParticipationId)}&eventTemplateVersionItemId=${encodeURIComponent(item.id)}`}
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
        to="/my-events/$eventOccurrenceId/surveys/$eventTemplateVersionItemId"
        params={{ eventOccurrenceId, eventTemplateVersionItemId: item.id }}
      >
        <Button component="span" variant="light" size="xs">
          {item.completionState === "completed"
            ? "View receipt"
            : "Complete survey"}
        </Button>
      </Link>
    );
  if (item.kind === "scorm")
    return (
      <LazyFullscreenScormLauncher
        title={item.title}
        payload={{
          eventParticipationId,
          eventTemplateVersionItemId: item.id,
        }}
        onExit={refreshSoon}
      />
    );
  return null;
}
