import { destroyDatabase } from "#/server/db/database.server";
import { dispatchAvailableOutboxEvents } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { processAvailableEventCommunicationSchedules } from "#/server/notifications/event-communication-execution.server";
import { consumeNextWorkMessage } from "#/server/scorm/scorm-ingestion-consumer.server";
import { processAvailableEventVirtualRoomOperations } from "#/server/events/event-virtual-room.server";
import { processAvailableEventVirtualRecoveryDeliveries } from "#/server/events/event-virtual-recovery-delivery.server";
import { processAvailableEventVirtualLobbyEligibilityRevocations } from "#/server/events/event-virtual-lobby-reconciliation.server";
import { runScormWorkerIteration } from "./scorm-worker-iteration";

const shutdown = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    shutdown.abort();
  });

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  while (!shutdown.signal.aborted) {
    const {
      schedules,
      virtualRooms,
      virtualLobbyEligibilityRevocations,
      virtualRecoveryDeliveries,
      dispatch,
      consumption,
    } = await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules,
      processAvailableEventVirtualRoomOperations,
      processAvailableEventVirtualLobbyEligibilityRevocations,
      processAvailableEventVirtualRecoveryDeliveries,
      dispatchAvailableOutboxEvents,
      consumeNextWorkMessage,
    });
    for (const outcome of schedules.outcomes)
      logServerEvent({
        level:
          outcome.status === "retry" || outcome.status === "failed"
            ? "warn"
            : "info",
        event: "worker.event_communication_schedule_processed",
        fields: {
          status: outcome.status,
          scheduleId: outcome.scheduleId,
          ...(outcome.status === "completed"
            ? { recipientCount: outcome.recipientCount }
            : {}),
        },
      });
    for (const outcome of dispatch.outcomes)
      logServerEvent({
        level: outcome.status === "retry" ? "warn" : "info",
        event: "worker.outbox_processed",
        fields: {
          status: outcome.status,
          eventId: outcome.eventId,
          ...(outcome.status === "dispatched"
            ? { messageId: outcome.messageId }
            : {}),
        },
      });
    for (const outcome of virtualRooms.outcomes)
      logServerEvent({
        level: outcome.status === "retry" ? "warn" : "info",
        event: "worker.event_virtual_room_operation_processed",
        fields: {
          status: outcome.status,
          operationId: outcome.operationId,
          roomId: outcome.roomId,
          kind: outcome.kind,
        },
      });
    for (const outcome of virtualLobbyEligibilityRevocations.outcomes)
      logServerEvent({
        level: "info",
        event: "worker.event_virtual_lobby_eligibility_revoked",
        fields: {
          status: outcome.status,
          lobbyEntryId: outcome.lobbyEntryId,
        },
      });
    for (const outcome of virtualRecoveryDeliveries.outcomes)
      logServerEvent({
        level:
          outcome.status === "failed" || outcome.status === "unknown"
            ? "warn"
            : "info",
        event: "worker.event_virtual_recovery_delivery_processed",
        fields: {
          status: outcome.status,
          challengeId: outcome.challengeId,
        },
      });
    if (consumption.status !== "no-work")
      logServerEvent({
        level: consumption.status === "retry" ? "warn" : "info",
        event: "worker.work_processed",
        fields: {
          status: consumption.status,
          messageId: consumption.messageId,
          receiveCount: consumption.receiveCount,
          ...(consumption.status === "processed"
            ? {
                eventId: consumption.eventId,
                aggregateId: consumption.aggregateId,
                outcome: consumption.outcome.status,
              }
            : {}),
        },
      });
    if (
      schedules.outcomes.length === 0 &&
      virtualRooms.outcomes.length === 0 &&
      virtualLobbyEligibilityRevocations.outcomes.length === 0 &&
      virtualRecoveryDeliveries.outcomes.length === 0 &&
      dispatch.outcomes.length === 0 &&
      consumption.status === "no-work"
    )
      await pause(1_000);
  }
} catch (error) {
  logServerEvent({ level: "error", event: "worker.fatal", error });
  process.exitCode = 1;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
