import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { eventSurveyQrPresentationParamsSchema } from "#/features/event-operations/event-operations.schema";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { getEventSurveyQrPresentation } from "#/server/functions/event-operations";
import classes from "./event-survey-presentation.module.css";

export const Route = createFileRoute(
  "/event-operations/$eventOccurrenceId_/survey-qr/$eventSurveyAccessId",
)({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = eventSurveyQrPresentationParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getEventSurveyQrPresentation({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/event-operations/${encodeURIComponent(parsed.data.eventOccurrenceId)}/survey-qr/${encodeURIComponent(parsed.data.eventSurveyAccessId)}`,
        },
      });
    if (result.status !== "ready") throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.access.title} QR — ${loaderData.occurrenceTitle}`
          : "Event Survey QR — Upskill",
      },
    ],
  }),
  component: EventSurveyQrPresentationPage,
});

function EventSurveyQrPresentationPage() {
  const presentation = Route.useLoaderData();
  const navigate = useNavigate();
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  useEffect(() => {
    const update = () => {
      setBrowserFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);

  const exitPresentation = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    await navigate({
      to: "/event-operations/$eventOccurrenceId",
      params: { eventOccurrenceId: presentation.occurrenceId },
      search: { view: "survey_qr", q: "", state: "all" },
    });
  };

  return (
    <main className={classes.presentation}>
      <Stack gap="md" className={classes.content}>
        <Group justify="space-between" align="start" wrap="wrap">
          <div>
            <Text fw={700} c="indigo.7">
              {presentation.occurrenceTitle}
            </Text>
            <Title order={1}>{presentation.access.title}</Title>
            <Text c="dimmed">{presentation.access.sectionTitle}</Text>
          </div>
          <Group gap="sm">
            {!browserFullscreen ? (
              <Button
                variant="light"
                onClick={() => {
                  if (document.fullscreenEnabled)
                    void document.documentElement.requestFullscreen();
                }}
              >
                Use browser fullscreen
              </Button>
            ) : null}
            <Button variant="default" onClick={() => void exitPresentation()}>
              Exit presentation
            </Button>
          </Group>
        </Group>

        {presentation.access.status === "preview" ? (
          <Alert color="orange" title="Draft preview">
            The code can be previewed, but learners cannot open this Survey
            until the Event Instance is published.
          </Alert>
        ) : null}

        <div className={classes.qrStage}>
          <img
            src={`/api/event-surveys/${encodeURIComponent(presentation.access.publicReference)}/qr.svg`}
            alt={`QR code for ${presentation.access.title}`}
            className={classes.qrImage}
          />
          <Text fw={700} size="xl" className={classes.centeredText}>
            Scan to open the event Survey
          </Text>
        </div>
      </Stack>
    </main>
  );
}
