import "@tanstack/react-start/server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  EventVirtualAttendeeCredentialResult,
  EventVirtualLobbyMutationResult,
  EventVirtualLobbyResult,
  EventVirtualRecoveryRequestResult,
  EventVirtualRecoveryVerificationResult,
} from "#/features/event-lobby/event-virtual-lobby.schema";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import {
  consumeFixedWindowRateLimit,
  forwardedClientAddress,
  type FixedWindowRateLimitEntry,
} from "#/features/event-guest/event-guest-rate-limit";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import {
  createConfiguredLiveKitProvider,
  getEnabledLiveKitConfiguration,
  LiveKitProviderError,
  type LiveKitProvider,
} from "#/server/livekit/livekit-provider.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  isAmbiguousEmailDeliveryError,
  sendEventVirtualRecoveryEmail,
} from "#/server/notifications/email-provider.server";
import {
  isAmbiguousSmsDeliveryError,
  sendEventVirtualRecoverySms,
} from "#/server/notifications/sms-provider.server";
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";
import { admitEligibleWaitingEntries } from "./event-virtual-lobby-admission.server";
import { lockVirtualRoomStaffAccess } from "./event-virtual-staff-access.server";

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const JOIN_SESSION_LIFETIME_MS = 30 * 60_000;
const JOIN_SESSION_IDLE_MS = 10 * 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAXIMUM_ENTRIES = 20_000;
const POLL_AFTER_MS = 4_000;
const requestLimits = new Map<string, FixedWindowRateLimitEntry>();
const DEVELOPMENT_COOKIE = "upskill_virtual_join";
const SECURE_COOKIE = "__Secure-upskill_virtual_join";
const DEVELOPMENT_CHALLENGE_COOKIE = "upskill_virtual_challenge";
const SECURE_CHALLENGE_COOKIE = "__Secure-upskill_virtual_challenge";

interface RecoveryDeliveryOverrides {
  sendEmail?: typeof sendEventVirtualRecoveryEmail;
  sendSms?: typeof sendEventVirtualRecoverySms;
  requestLimitStore?: Map<string, FixedWindowRateLimitEntry>;
}

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

interface VirtualLobbyActor {
  user: AuthenticatedUser;
  accessMethod: "authenticated" | "email" | "sms";
  eventParticipationId?: string;
  joinSessionId?: string;
}

function secretDigest(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(value)
    .digest("base64url");
}

function opaqueReference(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

function secureEnvironment(): boolean {
  return ["production", "staging"].includes(getServerEnv().APP_ENV);
}

function cookieName(): string {
  return secureEnvironment() ? SECURE_COOKIE : DEVELOPMENT_COOKIE;
}

function challengeCookieName(): string {
  return secureEnvironment()
    ? SECURE_CHALLENGE_COOKIE
    : DEVELOPMENT_CHALLENGE_COOKIE;
}

function cookieValue(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator >= 0 && pair.slice(0, separator).trim() === name)
      return pair.slice(separator + 1).trim();
  }
  return null;
}

function scopedCookie(name: string, value: string, maximumAge: number): string {
  return [
    `${name}=${value}`,
    "Path=/webinars",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(maximumAge)}`,
    ...(secureEnvironment() ? ["Secure"] : []),
  ].join("; ");
}

export function eventVirtualJoinSessionCookie(token: string): string {
  return scopedCookie(cookieName(), token, JOIN_SESSION_LIFETIME_MS / 1_000);
}

export function eventVirtualChallengeCookie(reference: string): string {
  return scopedCookie(
    challengeCookieName(),
    reference,
    CHALLENGE_LIFETIME_MS / 1_000,
  );
}

export function clearEventVirtualChallengeCookie(): string {
  return scopedCookie(challengeCookieName(), "", 0);
}

export function readEventVirtualChallengeCookie(
  request: Request,
): string | null {
  const reference = cookieValue(request.headers, challengeCookieName());
  return reference && /^[A-Za-z0-9_-]{32}$/u.test(reference) ? reference : null;
}

function requestFingerprint(publicReference: string): string {
  return secretDigest(
    `${publicReference}:${forwardedClientAddress(getRequestHeaders())}`,
  );
}

function consumeRequestLimit(
  publicReference: string,
  identifierDigest: string,
  fingerprint: string,
  store = requestLimits,
): boolean {
  const now = Date.now();
  return (
    consumeFixedWindowRateLimit(
      store,
      `identifier:${publicReference}:${identifierDigest}`,
      now,
      {
        maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
        maximumRequests: 3,
        windowMs: RATE_LIMIT_WINDOW_MS,
      },
    ) &&
    consumeFixedWindowRateLimit(store, `connection:${fingerprint}`, now, {
      maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
      maximumRequests: 10,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  );
}

async function findPublicDestination(
  connection: DatabaseConnection,
  publicReference: string,
) {
  return await connection
    .selectFrom("event_virtual_join_access as access")
    .innerJoin(
      "event_session as session",
      "session.id",
      "access.eventSessionId",
    )
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "access.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .leftJoin("event_virtual_room as room", (join) =>
      join
        .onRef("room.eventSessionId", "=", "access.eventSessionId")
        .onRef("room.generation", "=", "access.roomGeneration")
        .on("room.replacedAt", "is", null),
    )
    .select([
      "access.id as eventVirtualJoinAccessId",
      "access.eventOccurrenceId",
      "access.eventSessionId",
      "access.roomGeneration",
      "occurrence.title as eventTitle",
      "occurrence.status as occurrenceStatus",
      "occurrence.publishedAt",
      "occurrence.timezone",
      "version.registrationSurveyVersionId",
      "session.title as sessionTitle",
      "session.startsAt",
      "session.endsAt",
      "session.livekitAdmissionMode",
      "session.livekitAttendeeRejoinGraceMinutes",
      "session.livekitAttendeeRecordingNotice",
      "room.id as roomId",
      "room.providerRoomName",
      "room.doorState",
      "room.lockedAt",
      "room.admissionMode",
      "room.recordingMode",
      "room.providerStatus",
    ])
    .where("access.publicReference", "=", publicReference)
    .where("access.revokedAt", "is", null)
    .where("session.virtualDeliveryProvider", "=", "livekit")
    .executeTakeFirst();
}

type PublicDestination = NonNullable<
  Awaited<ReturnType<typeof findPublicDestination>>
>;

function isTerminalDestination(
  destination: PublicDestination,
  now: Date,
): boolean {
  return (
    ["cancelled", "completed"].includes(destination.occurrenceStatus) ||
    destination.doorState === "ended" ||
    ((!destination.roomId || destination.doorState === "scheduled") &&
      destination.endsAt <= now)
  );
}

function canJoinThroughDoor(
  doorState: PublicDestination["doorState"],
  rejoinGraceMinutes: number | null,
  entry: {
    state: string;
    firstConnectedAt: Date | null;
    leftAt: Date | null;
  },
  now: Date,
): boolean {
  if (doorState === "open") return true;
  if (
    doorState !== "locked" ||
    !["admitted", "token_issued", "connected", "left"].includes(entry.state) ||
    !entry.firstConnectedAt ||
    !entry.leftAt ||
    entry.firstConnectedAt > entry.leftAt ||
    entry.leftAt > now
  )
    return false;
  const graceMilliseconds = (rejoinGraceMinutes ?? 0) * 60_000;
  return (
    graceMilliseconds > 0 &&
    now.getTime() <= entry.leftAt.getTime() + graceMilliseconds
  );
}

async function eligibleParticipation(
  connection: DatabaseConnection,
  destination: PublicDestination,
  userId: string,
) {
  const participation = await connection
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin("user", "user.id", "participation.userId")
    .select([
      "participation.id",
      "participation.userId",
      "participation.nameSnapshot",
      "participation.emailSnapshot",
      "registration.status as registrationStatus",
      "user.name",
      "user.email",
      "user.emailVerified",
    ])
    .where(
      "participation.eventOccurrenceId",
      "=",
      destination.eventOccurrenceId,
    )
    .where("participation.userId", "=", userId)
    .where("participation.mode", "=", "registered")
    .where("registration.status", "=", "selected")
    .executeTakeFirst();
  if (!participation) return null;
  if (!destination.registrationSurveyVersionId)
    return { ...participation, questionnaireComplete: true };
  const assignment = await connection
    .selectFrom("registration_questionnaire_assignment")
    .select("status")
    .where("eventOccurrenceId", "=", destination.eventOccurrenceId)
    .where("userId", "=", userId)
    .where("surveyVersionId", "=", destination.registrationSurveyVersionId)
    .executeTakeFirst();
  return {
    ...participation,
    questionnaireComplete:
      assignment?.status === "completed" || assignment?.status === "waived",
  };
}

async function recoveredActor(
  destination: PublicDestination,
  tokenOverride?: string | null,
): Promise<VirtualLobbyActor | null> {
  if (tokenOverride === null) return null;
  const token = tokenOverride ?? cookieValue(getRequestHeaders(), cookieName());
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const now = new Date();
  const idleAfter = new Date(now.getTime() - JOIN_SESSION_IDLE_MS);
  const row = await getDatabase()
    .selectFrom("event_virtual_join_session as joinSession")
    .innerJoin("user", "user.id", "joinSession.userId")
    .select([
      "joinSession.id",
      "joinSession.eventParticipationId",
      "joinSession.accessMethod",
      "joinSession.userId",
      "user.name",
      "user.email",
      "user.emailVerified",
    ])
    .where("joinSession.tokenDigest", "=", secretDigest(`join:${token}`))
    .where(
      "joinSession.eventVirtualJoinAccessId",
      "=",
      destination.eventVirtualJoinAccessId,
    )
    .where("joinSession.eventOccurrenceId", "=", destination.eventOccurrenceId)
    .where("joinSession.eventSessionId", "=", destination.eventSessionId)
    .where("joinSession.roomGeneration", "=", destination.roomGeneration)
    .where("joinSession.expiresAt", ">", now)
    .where("joinSession.lastUsedAt", ">", idleAfter)
    .where("joinSession.revokedAt", "is", null)
    .executeTakeFirst();
  if (!row) return null;
  await getDatabase()
    .updateTable("event_virtual_join_session")
    .set({ lastUsedAt: now })
    .where("id", "=", row.id)
    .where("revokedAt", "is", null)
    .execute();
  return {
    user: {
      id: row.userId,
      name: row.name,
      email: normalizeEmail(row.email),
      emailVerified: row.emailVerified,
    },
    accessMethod: row.accessMethod,
    eventParticipationId: row.eventParticipationId,
    joinSessionId: row.id,
  };
}

async function resolveActor(
  destination: PublicDestination,
  authenticatedUser: AuthenticatedUser | null,
  tokenOverride?: string | null,
): Promise<VirtualLobbyActor | null> {
  if (authenticatedUser)
    return { user: authenticatedUser, accessMethod: "authenticated" };
  return await recoveredActor(destination, tokenOverride);
}

async function ensureLobbyEntry(
  destination: PublicDestination,
  actor: VirtualLobbyActor,
  participation: NonNullable<Awaited<ReturnType<typeof eligibleParticipation>>>,
) {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`${destination.eventVirtualJoinAccessId}:${participation.id}`}, 0
    ))`.execute(transaction);
    const currentRoom = destination.roomId
      ? await transaction
          .selectFrom("event_virtual_room")
          .select("admissionMode")
          .where("id", "=", destination.roomId)
          .where("eventSessionId", "=", destination.eventSessionId)
          .where("generation", "=", destination.roomGeneration)
          .where("replacedAt", "is", null)
          .forUpdate()
          .executeTakeFirst()
      : null;
    const currentAccess = await transaction
      .selectFrom("event_virtual_join_access")
      .select("id")
      .where("id", "=", destination.eventVirtualJoinAccessId)
      .where("revokedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!currentAccess) return null;
    const existing = await transaction
      .selectFrom("event_virtual_lobby_entry")
      .selectAll()
      .where(
        "eventVirtualJoinAccessId",
        "=",
        destination.eventVirtualJoinAccessId,
      )
      .where("eventParticipationId", "=", participation.id)
      .forUpdate()
      .executeTakeFirst();
    const now = new Date();
    const automatic =
      (currentRoom?.admissionMode ?? destination.livekitAdmissionMode) ===
      "automatic";
    if (existing?.state === "waiting" && automatic) {
      const admitted = await transaction
        .updateTable("event_virtual_lobby_entry")
        .set({
          state: "admitted",
          admittedAt: now,
          admittedByUserId: null,
          updatedAt: now,
        })
        .where("id", "=", existing.id)
        .where("state", "=", "waiting")
        .returningAll()
        .executeTakeFirst();
      if (!admitted) return existing;
      await advanceEventVirtualLobbyRevision(
        transaction,
        destination.eventVirtualJoinAccessId,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: null,
        action: "event_virtual_lobby.admission_changed",
        subjectType: "event_virtual_lobby_entry",
        subjectId: admitted.id,
        aggregateId: destination.eventOccurrenceId,
        metadata: {
          action: "admit",
          eventSessionId: destination.eventSessionId,
          source: "automatic_eligibility_restored",
        },
        createdAt: now,
      });
      return admitted;
    }
    if (existing && (existing.state !== "revoked" || existing.revokedByUserId))
      return existing;
    if (existing) {
      const restored = await transaction
        .updateTable("event_virtual_lobby_entry")
        .set({
          state: automatic ? "admitted" : "waiting",
          accessMethod: actor.accessMethod,
          admittedAt: automatic ? now : null,
          admittedByUserId: null,
          revokedAt: null,
          revokedByUserId: null,
          updatedAt: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await advanceEventVirtualLobbyRevision(
        transaction,
        destination.eventVirtualJoinAccessId,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.user.id,
        action: "event_virtual_lobby.admission_changed",
        subjectType: "event_virtual_lobby_entry",
        subjectId: existing.id,
        aggregateId: destination.eventOccurrenceId,
        metadata: {
          action: "reactivate",
          admissionMode: automatic ? "automatic" : "manual",
          eventSessionId: destination.eventSessionId,
          source: "eligibility_restored",
        },
        createdAt: now,
      });
      return restored;
    }
    const entry = await transaction
      .insertInto("event_virtual_lobby_entry")
      .values({
        id: `event_virtual_lobby_${randomUUID()}`,
        eventVirtualJoinAccessId: destination.eventVirtualJoinAccessId,
        eventOccurrenceId: destination.eventOccurrenceId,
        eventSessionId: destination.eventSessionId,
        roomGeneration: destination.roomGeneration,
        eventParticipationId: participation.id,
        state: automatic ? "admitted" : "waiting",
        accessMethod: actor.accessMethod,
        requestedAt: now,
        admittedAt: automatic ? now : null,
        admittedByUserId: null,
        declinedAt: null,
        declinedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
        firstTokenIssuedAt: null,
        recordingAcknowledgedAt: null,
        recordingNoticeDigest: null,
        firstConnectedAt: null,
        lastSeenAt: null,
        leftAt: null,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await advanceEventVirtualLobbyRevision(
      transaction,
      destination.eventVirtualJoinAccessId,
    );
    await recordDurableAuditEvent(transaction, {
      actorUserId: actor.user.id,
      action: "event_virtual_lobby.requested",
      subjectType: "event_virtual_lobby_entry",
      subjectId: entry.id,
      aggregateId: destination.eventOccurrenceId,
      metadata: {
        accessMethod: actor.accessMethod,
        eventSessionId: destination.eventSessionId,
        roomGeneration: destination.roomGeneration,
      },
      createdAt: now,
    });
    if (automatic)
      await recordDurableAuditEvent(transaction, {
        actorUserId: null,
        action: "event_virtual_lobby.admission_changed",
        subjectType: "event_virtual_lobby_entry",
        subjectId: entry.id,
        aggregateId: destination.eventOccurrenceId,
        metadata: { action: "admit", source: "automatic" },
        createdAt: now,
      });
    return entry;
  });
}

async function revokeIneligibleLobbyAccess(
  destination: PublicDestination,
  userId: string,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const access = await transaction
        .selectFrom("event_virtual_join_access")
        .select("id")
        .where("id", "=", destination.eventVirtualJoinAccessId)
        .where("revokedAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!access) return;
      const participation = await transaction
        .selectFrom("event_participation")
        .select("id")
        .where("eventOccurrenceId", "=", destination.eventOccurrenceId)
        .where("userId", "=", userId)
        .executeTakeFirst();
      if (!participation) return;
      const entry = await transaction
        .selectFrom("event_virtual_lobby_entry")
        .select(["id", "state"])
        .where(
          "eventVirtualJoinAccessId",
          "=",
          destination.eventVirtualJoinAccessId,
        )
        .where("eventParticipationId", "=", participation.id)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      if (entry && !["declined", "revoked"].includes(entry.state)) {
        await transaction
          .updateTable("event_virtual_lobby_entry")
          .set({ state: "revoked", revokedAt: now, updatedAt: now })
          .where("id", "=", entry.id)
          .execute();
        await advanceEventVirtualLobbyRevision(
          transaction,
          destination.eventVirtualJoinAccessId,
        );
        await recordDurableAuditEvent(transaction, {
          actorUserId: null,
          action: "event_virtual_lobby.admission_changed",
          subjectType: "event_virtual_lobby_entry",
          subjectId: entry.id,
          aggregateId: destination.eventOccurrenceId,
          metadata: {
            action: "revoke",
            eventSessionId: destination.eventSessionId,
            source: "eligibility_changed",
          },
          createdAt: now,
        });
      }
      await transaction
        .updateTable("event_virtual_join_session")
        .set({ revokedAt: now })
        .where(
          "eventVirtualJoinAccessId",
          "=",
          destination.eventVirtualJoinAccessId,
        )
        .where("userId", "=", userId)
        .where("revokedAt", "is", null)
        .execute();
    });
}

function recordingNotice(destination: PublicDestination): string | null {
  return destination.recordingMode === "automatic"
    ? destination.livekitAttendeeRecordingNotice?.trim() ||
        "This webinar will be recorded. By joining, you acknowledge the recording notice."
    : null;
}

function recordingDigest(notice: string): string {
  return createHash("sha256").update(notice).digest("base64url");
}

export async function resolveEventVirtualLobby(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  options: { joinSessionToken?: string | null; clock?: () => Date } = {},
): Promise<EventVirtualLobbyResult> {
  const destination = await findPublicDestination(
    getDatabase(),
    publicReference,
  );
  if (!destination) return { status: "not-found" };
  const now = options.clock?.() ?? new Date();
  const publicBase = {
    eventTitle: destination.eventTitle,
    sessionTitle: destination.sessionTitle,
    startsAt: destination.startsAt.toISOString(),
    endsAt: destination.endsAt.toISOString(),
    timezone: destination.timezone,
  };
  const base = {
    ...publicBase,
    eventOccurrenceId: destination.eventOccurrenceId,
    questionnaireUrl: `/my-events/${encodeURIComponent(destination.eventOccurrenceId)}`,
  };
  const empty = {
    ...publicBase,
    eventOccurrenceId: null,
    questionnaireUrl: null,
    admissionState: "not_requested" as const,
    accessMethod: null,
    recording: { enabled: false, notice: null, acknowledged: false },
    pollAfterMilliseconds: null,
  };
  if (
    !destination.publishedAt ||
    ["draft", "archived"].includes(destination.occurrenceStatus)
  )
    return { status: "not-found" };
  if (isTerminalDestination(destination, now))
    return { status: "ready", data: { ...empty, outcome: "ended" } };
  const actor = await resolveActor(
    destination,
    authenticatedUser,
    options.joinSessionToken,
  );
  if (!actor)
    return {
      status: "ready",
      data: { ...empty, outcome: "authentication_required" },
    };
  const participation = await eligibleParticipation(
    getDatabase(),
    destination,
    actor.user.id,
  );
  if (!participation) {
    await revokeIneligibleLobbyAccess(destination, actor.user.id);
    return { status: "ready", data: { ...empty, outcome: "revoked" } };
  }
  if (
    actor.eventParticipationId &&
    actor.eventParticipationId !== participation.id
  ) {
    await revokeIneligibleLobbyAccess(destination, actor.user.id);
    return { status: "ready", data: { ...empty, outcome: "revoked" } };
  }
  if (!participation.questionnaireComplete)
    return {
      status: "ready",
      data: {
        ...base,
        admissionState: "not_requested",
        accessMethod: actor.accessMethod,
        outcome: "questionnaire_required",
        recording: { enabled: false, notice: null, acknowledged: false },
        pollAfterMilliseconds: null,
      },
    };
  const entry = await ensureLobbyEntry(destination, actor, participation);
  if (!entry) return { status: "not-found" };
  const notice = recordingNotice(destination);
  const acknowledged = Boolean(
    notice && entry.recordingNoticeDigest === recordingDigest(notice),
  );
  const data = {
    ...base,
    admissionState: entry.state,
    accessMethod: actor.accessMethod,
    recording: { enabled: Boolean(notice), notice, acknowledged },
  };
  if (entry.state === "declined")
    return {
      status: "ready",
      data: { ...data, outcome: "declined", pollAfterMilliseconds: null },
    };
  if (entry.state === "revoked")
    return {
      status: "ready",
      data: { ...data, outcome: "revoked", pollAfterMilliseconds: null },
    };
  if (!destination.roomId || destination.doorState === "scheduled")
    return {
      status: "ready",
      data: {
        ...data,
        outcome: "meeting_not_started",
        pollAfterMilliseconds: POLL_AFTER_MS,
      },
    };
  if (
    destination.doorState === "locked" &&
    !canJoinThroughDoor(
      destination.doorState,
      destination.livekitAttendeeRejoinGraceMinutes,
      entry,
      now,
    )
  )
    return {
      status: "ready",
      data: {
        ...data,
        outcome: "locked",
        pollAfterMilliseconds: POLL_AFTER_MS,
      },
    };
  if (entry.state === "waiting")
    return {
      status: "ready",
      data: {
        ...data,
        outcome: "waiting_for_admission",
        pollAfterMilliseconds: POLL_AFTER_MS,
      },
    };
  if (notice && !acknowledged)
    return {
      status: "ready",
      data: {
        ...data,
        outcome: "recording_acknowledgement_required",
        pollAfterMilliseconds: null,
      },
    };
  if (destination.providerStatus !== "ready")
    return {
      status: "ready",
      data: {
        ...data,
        outcome: "provider_unavailable",
        pollAfterMilliseconds: POLL_AFTER_MS,
      },
    };
  return {
    status: "ready",
    data: { ...data, outcome: "ready_to_join", pollAfterMilliseconds: null },
  };
}

function recoveryEmail(input: {
  code: string;
  eventTitle: string;
  sessionTitle: string;
}) {
  const title = input.eventTitle.replace(/[\r\n]+/gu, " ").trim();
  return {
    subject: `Your Upskill webinar access code for ${title}`.slice(0, 180),
    textBody: [
      `Your Upskill webinar access code is ${input.code}.`,
      "",
      `Use it to enter the waiting room for ${input.sessionTitle}.`,
      "This code expires in 10 minutes and can be used once.",
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    htmlBody: `<p>Your Upskill webinar access code is <strong>${input.code}</strong>.</p><p>Use it to enter the webinar waiting room. It expires in 10 minutes and can be used once.</p><p>If you did not request it, you can ignore this email.</p>`,
  };
}

export async function requestEventVirtualRecoveryCode(
  input: { publicReference: string; identifier: string },
  fingerprintOverride?: string,
  deliveryOverrides: RecoveryDeliveryOverrides = {},
): Promise<EventVirtualRecoveryRequestResult> {
  const database = getDatabase();
  const phone = normalizeInternationalPhone(input.identifier);
  const channel = phone ? ("sms" as const) : ("email" as const);
  const normalizedIdentifier = phone ?? normalizeEmail(input.identifier);
  const identifierDigest = secretDigest(`${channel}:${normalizedIdentifier}`);
  const fingerprint =
    fingerprintOverride ?? requestFingerprint(input.publicReference);
  if (
    !consumeRequestLimit(
      input.publicReference,
      identifierDigest,
      fingerprint,
      deliveryOverrides.requestLimitStore,
    )
  )
    return { status: "rate-limited" };
  const destination = await findPublicDestination(
    database,
    input.publicReference,
  );
  if (!destination?.publishedAt || destination.occurrenceStatus !== "published")
    return { status: "unavailable" };
  if (isTerminalDestination(destination, new Date()))
    return { status: "unavailable" };
  const fallbackReference = opaqueReference();
  const participant = await database
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin("user", "user.id", "participation.userId")
    .select([
      "participation.id",
      "participation.userId",
      "user.name",
      "user.email",
    ])
    .where(
      "participation.eventOccurrenceId",
      "=",
      destination.eventOccurrenceId,
    )
    .where("participation.mode", "=", "registered")
    .where("registration.status", "=", "selected")
    .where(
      channel === "sms"
        ? sql<boolean>`"user"."smsEnabled" = true and "user"."smsVerifiedAt" is not null and "user".phone = ${normalizedIdentifier}`
        : sql<boolean>`"user"."emailEnabled" = true and "user"."emailVerified" = true and lower("user".email) = ${normalizedIdentifier}`,
    )
    .executeTakeFirst();
  if (!participant)
    return { status: "accepted", challengeReference: fallbackReference };
  const eligibility = await eligibleParticipation(
    database,
    destination,
    participant.userId,
  );
  if (!eligibility?.questionnaireComplete)
    return { status: "accepted", challengeReference: fallbackReference };
  const challengeId = `event_virtual_recovery_${randomUUID()}`;
  const challengeReference = opaqueReference();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const reserved = await database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`event-virtual-recovery:${destination.eventVirtualJoinAccessId}:${identifierDigest}`}, 0
    ))`.execute(transaction);
    const reservedAt = new Date();
    const recent = await transaction
      .selectFrom("event_virtual_recovery_challenge")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where(
        "eventVirtualJoinAccessId",
        "=",
        destination.eventVirtualJoinAccessId,
      )
      .where("identifierDigest", "=", identifierDigest)
      .where(
        "createdAt",
        ">",
        new Date(reservedAt.getTime() - RATE_LIMIT_WINDOW_MS),
      )
      .executeTakeFirstOrThrow();
    if (Number(recent.count) >= 3) return false;
    await transaction
      .updateTable("event_virtual_recovery_challenge")
      .set({ consumedAt: reservedAt })
      .where(
        "eventVirtualJoinAccessId",
        "=",
        destination.eventVirtualJoinAccessId,
      )
      .where("userId", "=", participant.userId)
      .where("consumedAt", "is", null)
      .execute();
    await transaction
      .insertInto("event_virtual_recovery_challenge")
      .values({
        id: challengeId,
        reference: challengeReference,
        eventVirtualJoinAccessId: destination.eventVirtualJoinAccessId,
        eventOccurrenceId: destination.eventOccurrenceId,
        eventSessionId: destination.eventSessionId,
        roomGeneration: destination.roomGeneration,
        eventParticipationId: participant.id,
        userId: participant.userId,
        channel,
        identifierDigest,
        requestFingerprint: fingerprint,
        codeDigest: secretDigest(`code:${challengeId}:${code}`),
        attempts: 0,
        resendCount: 0,
        deliveryStatus: "pending",
        expiresAt: new Date(reservedAt.getTime() + CHALLENGE_LIFETIME_MS),
        consumedAt: null,
        createdAt: reservedAt,
      })
      .execute();
    return true;
  });
  if (!reserved)
    return { status: "accepted", challengeReference: fallbackReference };
  try {
    if (channel === "sms")
      await (deliveryOverrides.sendSms ?? sendEventVirtualRecoverySms)(
        database,
        {
          deliveryId: challengeId,
          recipientUserId: participant.userId,
          recipientName: participant.name,
          recipientPhone: normalizedIdentifier,
          message: `Your Upskill webinar access code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
        },
      );
    else
      await (deliveryOverrides.sendEmail ?? sendEventVirtualRecoveryEmail)(
        database,
        {
          challengeId,
          recipientEmail: normalizeEmail(participant.email),
          ...recoveryEmail({
            code,
            eventTitle: destination.eventTitle,
            sessionTitle: destination.sessionTitle,
          }),
        },
      );
    await database
      .updateTable("event_virtual_recovery_challenge")
      .set({ deliveryStatus: "sent" })
      .where("id", "=", challengeId)
      .execute();
  } catch (error) {
    const ambiguous =
      isAmbiguousEmailDeliveryError(error) ||
      isAmbiguousSmsDeliveryError(error);
    if (ambiguous)
      await database
        .updateTable("event_virtual_recovery_challenge")
        .set({ deliveryStatus: "unknown" })
        .where("id", "=", challengeId)
        .execute();
    else
      await database
        .updateTable("event_virtual_recovery_challenge")
        .set({ deliveryStatus: "failed", consumedAt: new Date() })
        .where("id", "=", challengeId)
        .execute();
    logServerEvent({
      level: "error",
      event: "event_virtual_lobby.recovery_delivery_failed",
      fields: {
        entityType: "event_virtual_join_access",
        entityId: destination.eventVirtualJoinAccessId,
        outcome: "failed",
      },
    });
  }
  return { status: "accepted", challengeReference };
}

function codeMatches(stored: string, candidate: string): boolean {
  const storedBuffer = Buffer.from(stored);
  const candidateBuffer = Buffer.from(candidate);
  return (
    storedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(storedBuffer, candidateBuffer)
  );
}

export async function verifyEventVirtualRecoveryCode(input: {
  publicReference: string;
  challengeReference: string;
  code: string;
}): Promise<EventVirtualRecoveryVerificationResult> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const locator = await transaction
      .selectFrom("event_virtual_recovery_challenge as challenge")
      .innerJoin(
        "event_virtual_join_access as access",
        "access.id",
        "challenge.eventVirtualJoinAccessId",
      )
      .select([
        "challenge.id",
        "challenge.eventVirtualJoinAccessId",
        "challenge.eventOccurrenceId",
        "challenge.eventSessionId",
        "challenge.roomGeneration",
      ])
      .where("challenge.reference", "=", input.challengeReference)
      .where("access.publicReference", "=", input.publicReference)
      .executeTakeFirst();
    if (!locator) return { status: "invalid" };
    // Match room lifecycle order and lock the challenge last because access
    // replacement consumes outstanding challenges in the same transaction.
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("status")
      .where("id", "=", locator.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    const session = await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", locator.eventSessionId)
      .where("eventOccurrenceId", "=", locator.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    await transaction
      .selectFrom("event_virtual_room")
      .select("id")
      .where("eventSessionId", "=", locator.eventSessionId)
      .where("generation", "=", locator.roomGeneration)
      .where("replacedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    const access = await transaction
      .selectFrom("event_virtual_join_access")
      .select("revokedAt")
      .where("id", "=", locator.eventVirtualJoinAccessId)
      .where("publicReference", "=", input.publicReference)
      .forUpdate()
      .executeTakeFirst();
    const challenge = await transaction
      .selectFrom("event_virtual_recovery_challenge as challenge")
      .select([
        "challenge.id",
        "challenge.eventVirtualJoinAccessId",
        "challenge.eventOccurrenceId",
        "challenge.eventSessionId",
        "challenge.roomGeneration",
        "challenge.eventParticipationId",
        "challenge.userId",
        "challenge.channel",
        "challenge.codeDigest",
        "challenge.attempts",
        "challenge.expiresAt",
        "challenge.consumedAt",
      ])
      .where("challenge.id", "=", locator.id)
      .forUpdate("challenge")
      .executeTakeFirst();
    const now = new Date();
    if (
      !occurrence ||
      !session ||
      !access ||
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      access.revokedAt ||
      occurrence.status !== "published"
    )
      return { status: "expired" };
    const destination = await findPublicDestination(
      transaction,
      input.publicReference,
    );
    if (!destination || isTerminalDestination(destination, now)) {
      await transaction
        .updateTable("event_virtual_recovery_challenge")
        .set({ consumedAt: now })
        .where("id", "=", challenge.id)
        .execute();
      return { status: "expired" };
    }
    const participation = await eligibleParticipation(
      transaction,
      destination,
      challenge.userId,
    );
    if (
      !participation?.questionnaireComplete ||
      participation.id !== challenge.eventParticipationId
    ) {
      await transaction
        .updateTable("event_virtual_recovery_challenge")
        .set({ consumedAt: now })
        .where("id", "=", challenge.id)
        .execute();
      return { status: "expired" };
    }
    if (challenge.attempts >= 5) return { status: "rate-limited" };
    const attempts = challenge.attempts + 1;
    if (
      !codeMatches(
        challenge.codeDigest,
        secretDigest(`code:${challenge.id}:${input.code}`),
      )
    ) {
      await transaction
        .updateTable("event_virtual_recovery_challenge")
        .set({ attempts })
        .where("id", "=", challenge.id)
        .execute();
      return attempts >= 5 ? { status: "rate-limited" } : { status: "invalid" };
    }
    const token = opaqueReference(32);
    const joinSessionId = `event_virtual_join_session_${randomUUID()}`;
    await transaction
      .updateTable("event_virtual_recovery_challenge")
      .set({ attempts, consumedAt: now })
      .where("id", "=", challenge.id)
      .execute();
    await transaction
      .insertInto("event_virtual_join_session")
      .values({
        id: joinSessionId,
        challengeId: challenge.id,
        tokenDigest: secretDigest(`join:${token}`),
        eventVirtualJoinAccessId: challenge.eventVirtualJoinAccessId,
        eventOccurrenceId: challenge.eventOccurrenceId,
        eventSessionId: challenge.eventSessionId,
        roomGeneration: challenge.roomGeneration,
        eventParticipationId: challenge.eventParticipationId,
        userId: challenge.userId,
        accessMethod: challenge.channel,
        expiresAt: new Date(now.getTime() + JOIN_SESSION_LIFETIME_MS),
        lastUsedAt: now,
        revokedAt: null,
        createdAt: now,
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: challenge.userId,
      action: "event_virtual_lobby.recovery_verified",
      subjectType: "event_virtual_join_session",
      subjectId: joinSessionId,
      aggregateId: challenge.eventOccurrenceId,
      metadata: {
        accessMethod: `${challenge.channel}_otp`,
        eventSessionId: challenge.eventSessionId,
        roomGeneration: challenge.roomGeneration,
      },
      createdAt: now,
    });
    return { status: "ready", joinSessionToken: token };
  });
}

async function actorAndEntry(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  joinSessionToken?: string,
) {
  const destination = await findPublicDestination(
    getDatabase(),
    publicReference,
  );
  if (!destination) return null;
  const actor = await resolveActor(
    destination,
    authenticatedUser,
    joinSessionToken,
  );
  if (!actor) return { destination, actor: null, entry: null };
  const participation = await eligibleParticipation(
    getDatabase(),
    destination,
    actor.user.id,
  );
  if (!participation || !participation.questionnaireComplete)
    return { destination, actor, entry: null };
  const entry = await getDatabase()
    .selectFrom("event_virtual_lobby_entry")
    .selectAll()
    .where(
      "eventVirtualJoinAccessId",
      "=",
      destination.eventVirtualJoinAccessId,
    )
    .where("eventParticipationId", "=", participation.id)
    .executeTakeFirst();
  return { destination, actor, entry, participation };
}

export async function acknowledgeEventVirtualRecording(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
): Promise<EventVirtualLobbyMutationResult> {
  const database = getDatabase();
  const initialDestination = await findPublicDestination(
    database,
    publicReference,
  );
  if (!initialDestination) return { status: "not-found" };
  const actor = await resolveActor(initialDestination, authenticatedUser);
  if (!actor) return { status: "unauthenticated" };
  return await database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("status")
      .where("id", "=", initialDestination.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    const room = initialDestination.roomId
      ? await transaction
          .selectFrom("event_virtual_room")
          .select("id")
          .where("id", "=", initialDestination.roomId)
          .where("replacedAt", "is", null)
          .forUpdate()
          .executeTakeFirst()
      : null;
    const access = await transaction
      .selectFrom("event_virtual_join_access")
      .select("id")
      .where("id", "=", initialDestination.eventVirtualJoinAccessId)
      .where("revokedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    const destination = access
      ? await findPublicDestination(transaction, publicReference)
      : null;
    if (!occurrence || !access || !destination)
      return { status: "not-found" } as const;
    const now = new Date();
    if (
      occurrence.status !== "published" ||
      (initialDestination.roomId && !room) ||
      isTerminalDestination(destination, now)
    )
      return { status: "conflict", reason: "session_ended" } as const;
    const recoveredJoinSession = actor.joinSessionId
      ? await transaction
          .selectFrom("event_virtual_join_session")
          .select("id")
          .where("id", "=", actor.joinSessionId)
          .where(
            "eventVirtualJoinAccessId",
            "=",
            destination.eventVirtualJoinAccessId,
          )
          .where("eventParticipationId", "=", actor.eventParticipationId ?? "")
          .where("userId", "=", actor.user.id)
          .where("expiresAt", ">", now)
          .where(
            "lastUsedAt",
            ">",
            new Date(now.getTime() - JOIN_SESSION_IDLE_MS),
          )
          .where("revokedAt", "is", null)
          .forUpdate()
          .executeTakeFirst()
      : null;
    if (actor.accessMethod !== "authenticated" && !recoveredJoinSession)
      return { status: "unauthenticated" } as const;
    const participation = await eligibleParticipation(
      transaction,
      destination,
      actor.user.id,
    );
    if (
      !participation?.questionnaireComplete ||
      (actor.eventParticipationId &&
        actor.eventParticipationId !== participation.id)
    )
      return { status: "conflict", reason: "ineligible" } as const;
    const notice = recordingNotice(destination);
    if (!notice)
      return { status: "conflict", reason: "invalid_transition" } as const;
    const entry = await transaction
      .selectFrom("event_virtual_lobby_entry")
      .select([
        "id",
        "state",
        "recordingAcknowledgedAt",
        "recordingNoticeDigest",
      ])
      .where(
        "eventVirtualJoinAccessId",
        "=",
        destination.eventVirtualJoinAccessId,
      )
      .where("eventParticipationId", "=", participation.id)
      .forUpdate()
      .executeTakeFirst();
    if (!entry) return { status: "conflict", reason: "ineligible" } as const;
    if (
      !["admitted", "token_issued", "connected", "left"].includes(entry.state)
    )
      return {
        status: "conflict",
        reason: "invalid_transition",
      } as const;
    const noticeDigest = recordingDigest(notice);
    if (entry.recordingAcknowledgedAt)
      return entry.recordingNoticeDigest === noticeDigest
        ? ({ status: "ready" } as const)
        : ({ status: "conflict", reason: "invalid_transition" } as const);
    const updated = await transaction
      .updateTable("event_virtual_lobby_entry")
      .set({
        recordingAcknowledgedAt: now,
        recordingNoticeDigest: noticeDigest,
        updatedAt: now,
      })
      .where("id", "=", entry.id)
      .where("state", "=", entry.state)
      .returning("id")
      .executeTakeFirst();
    return updated
      ? ({ status: "ready" } as const)
      : ({ status: "conflict", reason: "invalid_transition" } as const);
  });
}

function attendeeIdentity(roomId: string, participationId: string): string {
  return `attendee:${createHash("sha256")
    .update(`${roomId}:${participationId}`)
    .digest("base64url")}`;
}

export async function issueEventVirtualAttendeeCredential(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  options: {
    provider?: LiveKitProvider;
    websocketUrl?: string;
    joinSessionToken?: string;
  } = {},
): Promise<EventVirtualAttendeeCredentialResult> {
  const status = await resolveEventVirtualLobby(
    publicReference,
    authenticatedUser,
    options.joinSessionToken
      ? { joinSessionToken: options.joinSessionToken }
      : {},
  );
  if (status.status === "not-found") return { status: "not-found" };
  if (status.data.outcome === "authentication_required")
    return { status: "unauthenticated" };
  if (status.data.outcome !== "ready_to_join")
    return {
      status: "conflict",
      reason:
        status.data.outcome === "declined" ? "revoked" : status.data.outcome,
    };
  const resolved = await actorAndEntry(
    publicReference,
    authenticatedUser,
    options.joinSessionToken,
  );
  if (!resolved) return { status: "not-found" };
  if (!resolved.actor) return { status: "unauthenticated" };
  if (!resolved.entry) return { status: "conflict", reason: "revoked" };
  let provider: LiveKitProvider | null;
  let websocketUrl: string | undefined;
  try {
    provider = options.provider ?? createConfiguredLiveKitProvider();
    websocketUrl =
      options.websocketUrl ?? getEnabledLiveKitConfiguration()?.url;
  } catch {
    provider = null;
  }
  if (
    !provider ||
    !websocketUrl ||
    !resolved.destination.roomId ||
    !resolved.destination.providerRoomName
  )
    return { status: "conflict", reason: "provider_unavailable" };
  let credential;
  try {
    credential = await provider.createJoinToken({
      roomName: resolved.destination.providerRoomName,
      participantIdentity: attendeeIdentity(
        resolved.destination.roomId,
        resolved.participation.id,
      ),
      displayName:
        resolved.participation.nameSnapshot.trim().slice(0, 200) || "Attendee",
      role: "attendee",
    });
  } catch (error) {
    if (error instanceof LiveKitProviderError)
      return { status: "conflict", reason: "provider_unavailable" };
    throw error;
  }
  const lobbyEntryId = resolved.entry.id;
  const current = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("status")
        .where("id", "=", resolved.destination.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      const room = await transaction
        .selectFrom("event_virtual_room")
        .select(["id", "doorState", "providerStatus"])
        .where("id", "=", resolved.destination.roomId)
        .where("eventSessionId", "=", resolved.destination.eventSessionId)
        .where("generation", "=", resolved.destination.roomGeneration)
        .where("replacedAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      const access = await transaction
        .selectFrom("event_virtual_join_access")
        .select("id")
        .where("id", "=", resolved.destination.eventVirtualJoinAccessId)
        .where("revokedAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      const entry = await transaction
        .selectFrom("event_virtual_lobby_entry")
        .selectAll()
        .where("id", "=", lobbyEntryId)
        .forUpdate()
        .executeTakeFirst();
      const revalidationNow = new Date();
      const recoveredJoinSession = resolved.actor.joinSessionId
        ? await transaction
            .selectFrom("event_virtual_join_session")
            .select("id")
            .where("id", "=", resolved.actor.joinSessionId)
            .where(
              "eventVirtualJoinAccessId",
              "=",
              resolved.destination.eventVirtualJoinAccessId,
            )
            .where(
              "eventOccurrenceId",
              "=",
              resolved.destination.eventOccurrenceId,
            )
            .where("eventSessionId", "=", resolved.destination.eventSessionId)
            .where("roomGeneration", "=", resolved.destination.roomGeneration)
            .where("eventParticipationId", "=", resolved.participation.id)
            .where("userId", "=", resolved.actor.user.id)
            .where("expiresAt", ">", revalidationNow)
            .where(
              "lastUsedAt",
              ">",
              new Date(revalidationNow.getTime() - JOIN_SESSION_IDLE_MS),
            )
            .where("revokedAt", "is", null)
            .forUpdate()
            .executeTakeFirst()
        : null;
      const participation = await eligibleParticipation(
        transaction,
        resolved.destination,
        resolved.actor.user.id,
      );
      const notice = recordingNotice(resolved.destination);
      if (
        !access ||
        occurrence?.status !== "published" ||
        (resolved.actor.accessMethod !== "authenticated" &&
          !recoveredJoinSession) ||
        !room ||
        !canJoinThroughDoor(
          room.doorState,
          resolved.destination.livekitAttendeeRejoinGraceMinutes,
          entry ?? {
            state: "revoked",
            firstConnectedAt: null,
            leftAt: null,
          },
          revalidationNow,
        ) ||
        room.providerStatus !== "ready" ||
        !entry ||
        !["admitted", "token_issued", "connected", "left"].includes(
          entry.state,
        ) ||
        !participation?.questionnaireComplete ||
        (notice && entry.recordingNoticeDigest !== recordingDigest(notice))
      )
        return false;
      const now = new Date();
      const nextState =
        entry.state === "connected" ? "connected" : "token_issued";
      await transaction
        .updateTable("event_virtual_lobby_entry")
        .set({
          state: nextState,
          firstTokenIssuedAt: entry.firstTokenIssuedAt ?? now,
          updatedAt: now,
        })
        .where("id", "=", entry.id)
        .execute();
      if (entry.state !== nextState)
        await advanceEventVirtualLobbyRevision(
          transaction,
          resolved.destination.eventVirtualJoinAccessId,
        );
      await recordDurableAuditEvent(transaction, {
        actorUserId: resolved.actor.user.id,
        action: "event_virtual_lobby.attendee_token_issued",
        subjectType: "event_virtual_lobby_entry",
        subjectId: entry.id,
        aggregateId: resolved.destination.eventOccurrenceId,
        metadata: {
          eventSessionId: resolved.destination.eventSessionId,
          roomGeneration: resolved.destination.roomGeneration,
        },
        createdAt: now,
      });
      return true;
    });
  if (!current) return { status: "conflict", reason: "revoked" };
  return {
    status: "ready",
    credential: {
      token: credential.token,
      websocketUrl,
      expiresAt: credential.expiresAt.toISOString(),
      generation: resolved.destination.roomGeneration,
    },
  };
}

async function admissionEligible(
  transaction: Transaction<Database>,
  destination: PublicDestination,
  entry: { eventParticipationId: string },
): Promise<boolean> {
  const participation = await transaction
    .selectFrom("event_participation")
    .select("userId")
    .where("id", "=", entry.eventParticipationId)
    .where("eventOccurrenceId", "=", destination.eventOccurrenceId)
    .executeTakeFirst();
  if (!participation) return false;
  return Boolean(
    (
      await eligibleParticipation(
        transaction,
        destination,
        participation.userId,
      )
    )?.questionnaireComplete,
  );
}

async function changeAdmission(
  transaction: Transaction<Database>,
  destination: PublicDestination,
  entryId: string,
  action: "admit" | "decline" | "revoke",
  actorUserId: string | null,
  now: Date,
): Promise<"ready" | "not-found" | "invalid-transition" | "ineligible"> {
  const entry = await transaction
    .selectFrom("event_virtual_lobby_entry")
    .selectAll()
    .where("id", "=", entryId)
    .where(
      "eventVirtualJoinAccessId",
      "=",
      destination.eventVirtualJoinAccessId,
    )
    .forUpdate()
    .executeTakeFirst();
  if (!entry) return "not-found";
  if (
    action === "admit" &&
    ["admitted", "token_issued", "connected"].includes(entry.state)
  )
    return "ready";
  if (action === "admit" && entry.state !== "waiting")
    return "invalid-transition";
  if (action === "decline" && entry.state !== "waiting")
    return "invalid-transition";
  if (action === "revoke" && ["declined", "revoked"].includes(entry.state))
    return entry.state === "revoked" ? "ready" : "invalid-transition";
  if (
    action === "admit" &&
    !(await admissionEligible(transaction, destination, entry))
  )
    return "ineligible";
  const updates =
    action === "admit"
      ? {
          state: "admitted" as const,
          admittedAt: entry.admittedAt ?? now,
          admittedByUserId: actorUserId,
        }
      : action === "decline"
        ? {
            state: "declined" as const,
            declinedAt: now,
            declinedByUserId: actorUserId,
          }
        : {
            state: "revoked" as const,
            revokedAt: now,
            revokedByUserId: actorUserId,
          };
  await transaction
    .updateTable("event_virtual_lobby_entry")
    .set({ ...updates, updatedAt: now })
    .where("id", "=", entry.id)
    .execute();
  await advanceEventVirtualLobbyRevision(
    transaction,
    destination.eventVirtualJoinAccessId,
  );
  await recordDurableAuditEvent(transaction, {
    actorUserId,
    action: "event_virtual_lobby.admission_changed",
    subjectType: "event_virtual_lobby_entry",
    subjectId: entry.id,
    aggregateId: destination.eventOccurrenceId,
    metadata: { action, eventSessionId: destination.eventSessionId },
    createdAt: now,
  });
  return "ready";
}

export async function mutateEventVirtualLobbyAdmission(
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    lobbyEntryId?: string;
    action: "admit" | "decline" | "revoke" | "admit_all";
  },
  user: AuthenticatedUser,
): Promise<EventVirtualLobbyMutationResult> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("status")
      .where("id", "=", input.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!occurrence) return { status: "not-found" } as const;
    if (occurrence.status !== "published")
      return { status: "conflict", reason: "session_ended" } as const;
    const room = await transaction
      .selectFrom("event_virtual_room")
      .select(["generation", "doorState"])
      .where("eventSessionId", "=", input.eventSessionId)
      .where("replacedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!room) return { status: "not-found" } as const;
    const access = await transaction
      .selectFrom("event_virtual_join_access")
      .select("publicReference")
      .where("eventSessionId", "=", input.eventSessionId)
      .where("eventOccurrenceId", "=", input.eventOccurrenceId)
      .where("roomGeneration", "=", room.generation)
      .where("revokedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!access) return { status: "not-found" } as const;
    if (
      !(await lockVirtualRoomStaffAccess(
        transaction,
        input.eventOccurrenceId,
        input.eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    const destination = await findPublicDestination(
      transaction,
      access.publicReference,
    );
    if (!destination) return { status: "not-found" } as const;
    const now = new Date();
    if (isTerminalDestination(destination, now))
      return { status: "conflict", reason: "session_ended" } as const;
    if (input.action === "admit_all") {
      await admitEligibleWaitingEntries(transaction, {
        eventOccurrenceId: input.eventOccurrenceId,
        eventSessionId: input.eventSessionId,
        roomGeneration: room.generation,
        actorUserId: user.id,
        now,
        source: "staff_admit_all",
      });
      return { status: "ready" } as const;
    }
    if (!input.lobbyEntryId) return { status: "not-found" } as const;
    const outcome = await changeAdmission(
      transaction,
      destination,
      input.lobbyEntryId,
      input.action,
      user.id,
      now,
    );
    if (outcome === "not-found") return { status: "not-found" } as const;
    if (outcome === "ineligible")
      return { status: "conflict", reason: "ineligible" } as const;
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" } as const;
    return { status: "ready" } as const;
  });
}
