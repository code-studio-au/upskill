import { createServerFn } from "@tanstack/react-start";
import {
  adminEventAddRegistrationSchema,
  adminEventAttendanceSchema,
  adminEventAccountSetupSchema,
  adminEventCoordinatorDecisionSchema,
  adminEventFinalDecisionSchema,
  adminEventGuestAccessRotateSchema,
  adminEventGuestAttendanceModeSchema,
  adminEventLifecycleSchema,
  adminEventOccurrenceOperationsParamsSchema,
  adminEventRegionLockSchema,
  adminEventRegistrationProfileRegionAlignmentSchema,
  adminEventRegistrationRegionGuestDecisionSchema,
  adminEventRegistrationRegionMismatchAcknowledgementSchema,
  adminEventRegistrationRegionReassignmentSchema,
  type AdminEventOperationsMutationResult,
  type AdminEventOperationsResult,
} from "#/features/admin-event/admin-event-operations.schema";

async function administratorRequest() {
  const { getAdministratorRequest } =
    await import("#/server/admin/admin-access.server");
  return await getAdministratorRequest();
}

export const getAdminEventOccurrenceOperations = createServerFn({
  method: "GET",
})
  .validator(adminEventOccurrenceOperationsParamsSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEventOccurrenceOperations } =
      await import("#/server/admin/admin-event-operations.server");
    const detail = await findAdminEventOccurrenceOperations(
      data.eventOccurrenceId,
    );
    return detail ? { status: "ready", data: detail } : { status: "not-found" };
  });

export const rotateAdminEventGuestAccess = createServerFn({ method: "POST" })
  .validator(adminEventGuestAccessRotateSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { rotateEventGuestAccessRecord } =
      await import("#/server/events/event-guest-access.server");
    const publicReference = await rotateEventGuestAccessRecord(
      data.eventOccurrenceId,
      request.user,
    );
    return publicReference ? { status: "ready" } : { status: "not-found" };
  });

export const setAdminEventGuestAttendanceMode = createServerFn({
  method: "POST",
})
  .validator(adminEventGuestAttendanceModeSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { setAdminEventGuestAttendanceMode: setMode } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await setMode(
      data.eventOccurrenceId,
      data.mode,
      request.user,
    );
    return outcome === "updated"
      ? { status: "ready" }
      : { status: "not-found" };
  });

export const decideAdminEventCoordinatorRegistration = createServerFn({
  method: "POST",
})
  .validator(adminEventCoordinatorDecisionSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { decideAdminEventCoordinatorRegistration: decide } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await decide(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "region-locked")
      return { status: "conflict", reason: "region_locked" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const acknowledgeAdminEventRegistrationRegionMismatch = createServerFn({
  method: "POST",
})
  .validator(adminEventRegistrationRegionMismatchAcknowledgementSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { acknowledgeAdminEventRegistrationRegionMismatch: acknowledge } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await acknowledge(
      data.eventOccurrenceId,
      data.registrationId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "no-mismatch")
      return { status: "conflict", reason: "region_mismatch_resolved" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const lockAdminEventRegion = createServerFn({ method: "POST" })
  .validator(adminEventRegionLockSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { lockAdminEventRegion: lock } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await lock(
      data.eventOccurrenceId,
      data.eventOccurrenceRegionId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const decideAdminEventFinalRegistration = createServerFn({
  method: "POST",
})
  .validator(adminEventFinalDecisionSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { decideAdminEventFinalRegistration: decide } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await decide(
      data.eventOccurrenceId,
      data.registrationId,
      data.decision,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "capacity-full")
      return { status: "conflict", reason: "capacity_full" };
    if (outcome === "domain-override-required")
      return { status: "conflict", reason: "domain_override_required" };
    if (outcome === "final-decision-locked")
      return { status: "conflict", reason: "final_decision_locked" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const reassignAdminEventRegistrationRegion = createServerFn({
  method: "POST",
})
  .validator(adminEventRegistrationRegionReassignmentSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { reassignAdminEventRegistrationRegion: reassign } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await reassign(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "locked-destination-confirmation-required")
      return {
        status: "conflict",
        reason: "locked_destination_reassignment_confirmation_required",
      };
    if (outcome === "finalized-confirmation-required")
      return {
        status: "conflict",
        reason: "finalized_reassignment_confirmation_required",
      };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const alignAdminEventRegistrationProfileRegion = createServerFn({
  method: "POST",
})
  .validator(adminEventRegistrationProfileRegionAlignmentSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { alignAdminEventRegistrationProfileRegion: align } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await align(
      data.eventOccurrenceId,
      data.registrationId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "no-mismatch")
      return { status: "conflict", reason: "region_mismatch_resolved" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const confirmAdminEventRegistrationRegionGuest = createServerFn({
  method: "POST",
})
  .validator(adminEventRegistrationRegionGuestDecisionSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { confirmAdminEventRegistrationRegionGuest: confirm } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await confirm(
      data.eventOccurrenceId,
      data.registrationId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "no-mismatch")
      return { status: "conflict", reason: "region_mismatch_resolved" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const addAdminEventRegistration = createServerFn({ method: "POST" })
  .validator(adminEventAddRegistrationSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { addAdminEventRegistration: add } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await add(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "unavailable")
      return { status: "conflict", reason: "registration_unavailable" };
    if (outcome === "override-required")
      return { status: "conflict", reason: "domain_override_required" };
    if (outcome === "duplicate")
      return { status: "conflict", reason: "duplicate_registration" };
    return { status: "ready" };
  });

export const recordAdminEventAttendance = createServerFn({ method: "POST" })
  .validator(adminEventAttendanceSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { recordAdminEventAttendance: record } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await record(data, request.user);
    if (outcome === "not-found")
      return { status: "conflict", reason: "attendance_unavailable" };
    return { status: "ready" };
  });

export const resendAdminEventAccountSetup = createServerFn({ method: "POST" })
  .validator(adminEventAccountSetupSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { resendAdminEventAccountSetup: resend } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await resend(
      data.eventOccurrenceId,
      data.userId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "already-active")
      return { status: "conflict", reason: "account_already_active" };
    return { status: "ready" };
  });

export const transitionAdminEventOccurrence = createServerFn({ method: "POST" })
  .validator(adminEventLifecycleSchema)
  .handler(async ({ data }): Promise<AdminEventOperationsMutationResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { transitionAdminEventOccurrence: transition } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await transition(
      data.eventOccurrenceId,
      data.target,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });
