import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { eventLateInvitationTokenSchema } from "#/features/learner/event-late-invitation.schema";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  acceptEventLateInvitation,
  getEventLateInvitation,
} from "#/server/functions/event-late-invitation";
import classes from "./login.module.css";

type InvitationState =
  | { status: "loading" }
  | {
      status: "ready";
      invitationId: string;
      eventOccurrenceId: string;
      eventTitle: string;
      eventStartsAt: string;
      timezone: string;
      expiresAt: string;
    }
  | { status: "accepted"; eventOccurrenceId: string }
  | {
      status:
        | "expired"
        | "forbidden"
        | "ineligible"
        | "invalid"
        | "revoked"
        | "unavailable";
    };

export const Route = createFileRoute("/event-invitation")({
  ssr: false,
  head: () => ({ meta: [{ title: "Event invitation — Upskill" }] }),
  component: EventInvitationPage,
});

function EventInvitationPage() {
  const [token] = useState(() => {
    if (typeof window === "undefined") return "";
    const parsed = eventLateInvitationTokenSchema.safeParse(
      new URLSearchParams(window.location.hash.slice(1)).get("token"),
    );
    return parsed.success ? parsed.data : "";
  });
  const [invitation, setInvitation] = useState<InvitationState>(
    token ? { status: "loading" } : { status: "invalid" },
  );
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    void getEventLateInvitation({ data: { token } })
      .then((result) => {
        if (!active) return;
        if (result.status === "unauthenticated") {
          const destination = `/event-invitation#token=${token}`;
          window.location.assign(
            `/login?redirect=${encodeURIComponent(destination)}`,
          );
          return;
        }
        setInvitation(result);
      })
      .catch(() => {
        if (active) setInvitation({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const accept = async () => {
    if (!token || invitation.status !== "ready") return;
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptEventLateInvitation({ data: { token } });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(`/event-invitation#token=${token}`)}`,
        );
        return;
      }
      if (
        result.status === "registered" ||
        result.status === "already-registered"
      ) {
        window.location.assign("/my-events");
        return;
      }
      setInvitation({ status: result.status });
    } catch {
      setError("The invitation could not be accepted. Please try again.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Container size="sm" className={classes.section}>
      <Paper
        withBorder
        radius="lg"
        p={{ base: "lg", sm: "xl" }}
        className={classes.card}
      >
        {invitation.status === "loading" ? (
          <LoadingSpinner label="Loading event invitation" />
        ) : invitation.status === "ready" ? (
          <Stack gap="lg">
            <div>
              <Text c="indigo.7" fw={700}>
                Personal event invitation
              </Text>
              <Title order={1}>{invitation.eventTitle}</Title>
            </div>
            <Text>
              Event starts{" "}
              {formatLocalDateTime(invitation.eventStartsAt, {
                timeZone: invitation.timezone,
              })}
              . This invitation expires{" "}
              {formatLocalDateTime(invitation.expiresAt, {
                timeZone: invitation.timezone,
              })}
              .
            </Text>
            {error ? (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            ) : null}
            <Button loading={accepting} onClick={() => void accept()}>
              Accept invitation
            </Button>
          </Stack>
        ) : invitation.status === "accepted" ? (
          <Stack gap="lg">
            <Title order={1}>Invitation already accepted</Title>
            <Text>Your registration is available in My events.</Text>
            <Button component={Link} to="/my-events">
              View my events
            </Button>
          </Stack>
        ) : (
          <Stack gap="lg">
            <Title order={1}>Invitation unavailable</Title>
            <Alert color="red" role="alert">
              {invitation.status === "forbidden"
                ? "This invitation belongs to a different verified account."
                : invitation.status === "ineligible"
                  ? "Your account no longer meets this event's registration requirements."
                  : invitation.status === "revoked"
                    ? "This invitation has been revoked."
                    : invitation.status === "expired"
                      ? "This invitation has expired."
                      : invitation.status === "unavailable"
                        ? "This invitation cannot currently be accepted."
                        : "This invitation link is invalid."}
            </Alert>
            <Button component={Link} to="/my-events" variant="light">
              Go to My events
            </Button>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
