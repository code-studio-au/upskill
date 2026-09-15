// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import { EventOperationsVirtualSessions } from "./EventOperationsVirtualSessions";

const eventSessionId = "event_session_1";
type VirtualSession = EventOperationsWorkspace["virtualSessions"][number];
type Room = NonNullable<VirtualSession["room"]>;
type Role = EventOperationsWorkspace["access"]["roles"][number];

function workspaceForGeneration(
  generation: number,
  options: { roles?: Role[]; room?: Partial<Room> } = {},
): EventOperationsWorkspace {
  return {
    occurrence: {
      id: "event_occurrence_1",
      title: "Webinar",
      status: "published",
      deliveryMode: "virtual",
      virtualDeliveryProvider: "livekit",
      timezone: "Australia/Sydney",
      startsAt: "2030-09-04T00:00:00.000Z",
      endsAt: "2030-09-04T01:00:00.000Z",
      venueName: "",
      venueAddress: "",
      virtualJoinUrl: "",
      capacity: 10,
      confirmedCount: 0,
    },
    guestAccess: null,
    access: {
      roles: options.roles ?? ["presenter"],
      canReviewRegistrations: false,
      canViewRegistrations: false,
      canRecordAttendance: false,
      canViewProgress: false,
      canViewSurveyQrCatalogue: false,
    },
    metrics: {
      registrations: 0,
      awaitingReview: 0,
      candidates: 0,
      confirmed: 0,
      completed: 0,
      upToDate: 0,
      preWorkAttention: 0,
    },
    regions: [],
    registrations: [],
    sessions: [],
    virtualSessions: [
      {
        eventSessionId,
        learnerCapacity: 5,
        preparationOpensAt: "2030-09-03T23:00:00.000Z",
        canEnterGreenRoom: false,
        presenterRecordingNotice: null,
        lobbyPath: null,
        recording: null,
        recordings: [],
        room: {
          id: `event_virtual_room_${String(generation)}`,
          eventSessionId,
          generation,
          maxParticipants: 10,
          doorState: "ended",
          admissionMode: "manual",
          providerStatus: "closed",
          providerErrorCode: null,
          createdAt: "2030-09-04T00:00:00.000Z",
          startedAt: "2030-09-04T00:01:00.000Z",
          lockedAt: null,
          reopenedAt: null,
          endedAt: "2030-09-04T01:00:00.000Z",
          ...options.room,
        },
      },
    ],
    participantProgress: [],
    surveyQrCatalogue: [],
  };
}

function sessionCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector("h3")?.closest("header")
    ?.parentElement?.parentElement;
  if (!card) throw new Error("Expected the webinar session card");
  return card;
}

describe("LiveKit room generation identity", () => {
  it("remounts room-scoped UI when a session receives a new generation", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = () => Promise.resolve();

    act(() => {
      root.render(
        <EventOperationsVirtualSessions
          workspace={workspaceForGeneration(1)}
          processingId={null}
          action={action}
        />,
      );
    });
    const previousGenerationCard = sessionCard(container);

    act(() => {
      root.render(
        <EventOperationsVirtualSessions
          workspace={workspaceForGeneration(2)}
          processingId={null}
          action={action}
        />,
      );
    });

    expect(sessionCard(container)).not.toBe(previousGenerationCard);

    act(() => {
      root.unmount();
    });
  });

  it("keeps a provider failure safe and exposes explicit replacement", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <EventOperationsVirtualSessions
          workspace={workspaceForGeneration(1, {
            room: {
              doorState: "scheduled",
              providerStatus: "error",
              providerErrorCode: "livekit_ensure_room",
              startedAt: null,
              endedAt: null,
            },
          })}
          processingId={null}
          action={() => Promise.resolve()}
        />,
      );
    });

    expect(container.textContent).toContain("Provider issue");
    expect(container.textContent).toContain(
      "The provider room needs attention. Check LiveKit and replace this generation only if retrying cannot recover it.",
    );
    expect(container.textContent).toContain("Replace generation");
    expect(container.textContent).not.toContain("livekit_ensure_room");

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start webinar",
    );
    expect(startButton).toBeDefined();
    expect(startButton?.disabled).toBe(true);

    act(() => {
      root.unmount();
    });
  });

  it("limits ended-generation recovery to administrators", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <EventOperationsVirtualSessions
          workspace={workspaceForGeneration(1)}
          processingId={null}
          action={() => Promise.resolve()}
        />,
      );
    });
    expect(container.textContent).not.toContain("Recover with new generation");

    act(() => {
      root.render(
        <EventOperationsVirtualSessions
          workspace={workspaceForGeneration(1, {
            roles: ["administrator"],
          })}
          processingId={null}
          action={() => Promise.resolve()}
        />,
      );
    });
    expect(container.textContent).toContain("Recover with new generation");

    act(() => {
      root.unmount();
    });
  });
});
