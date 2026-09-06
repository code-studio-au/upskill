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
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";
import { admitEligibleWaitingEntries } from "./event-virtual-lobby-admission.server";
import { lockEventVirtualAdmissionEligibility } from "./event-virtual-lobby-eligibility.server";
import { revokeEventVirtualLobbyEntryForEligibility } from "./event-virtual-lobby-reconciliation.server";
import {
  eventVirtualAttendeeIdentity,
  isEventVirtualAttendeeIdentity,
} from "./event-virtual-participant-identity.server";
import { enqueueEventVirtualParticipantRemoval } from "./event-virtual-provider-operation.server";
import { countUnconnectedVirtualCredentialReservations } from "./event-virtual-room-capacity.server";
import {
  enqueueEventVirtualRecoveryDelivery,
  lockEligibleRecoveryTarget,
} from "./event-virtual-recovery-delivery.server";
import { lockVirtualRoomStaffAccess } from "./event-virtual-staff-access.server";

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const JOIN_SESSION_LIFETIME_MS = 30 * 60_000;
const JOIN_SESSION_IDLE_MS = 10 * 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAXIMUM_ENTRIES = 20_000;
const REQUEST_AUDIT_MAXIMUM_WRITES = 10;
const VERIFICATION_AUDIT_MAXIMUM_WRITES = 10;
const POLL_AFTER_MS = 4_000;
const requestLimits = new Map<string, FixedWindowRateLimitEntry>();
const requestAuditLimits = new Map<string, FixedWindowRateLimitEntry>();
const verificationAuditLimits = new Map<string, FixedWindowRateLimitEntry>();
const credentialDenialAuditLimits = new Map<
  string,
  FixedWindowRateLimitEntry
>();
const DEVELOPMENT_COOKIE = "upskill_virtual_join";
const SECURE_COOKIE = "__Secure-upskill_virtual_join";
const DEVELOPMENT_CHALLENGE_COOKIE = "upskill_virtual_challenge";
const SECURE_CHALLENGE_COOKIE = "__Secure-upskill_virtual_challenge";

interface RecoveryRequestOverrides {
  requestLimitStore?: Map<string, FixedWindowRateLimitEntry>;
  auditLimitStore?: Map<string, FixedWindowRateLimitEntry>;
  beforeReserve?: () => Promise<void>;
}

interface RecoveryVerificationAuditOverrides {
  auditLimitStore?: Map<string, FixedWindowRateLimitEntry>;
}

interface RecoveryRequestAuditOverrides {
  auditLimitStore?: Map<string, FixedWindowRateLimitEntry>;
}

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

interface VirtualLobbyActor {
  user: AuthenticatedUser;
  accessMethod: "authenticated" | "email" | "sms" | "guest";
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

function cookieName(publicReference: string): string {
  const prefix = secureEnvironment() ? SECURE_COOKIE : DEVELOPMENT_COOKIE;
  return `${prefix}_${publicReference}`;
}

function challengeCookieName(publicReference: string): string {
  const prefix = secureEnvironment()
    ? SECURE_CHALLENGE_COOKIE
    : DEVELOPMENT_CHALLENGE_COOKIE;
  return `${prefix}_${publicReference}`;
}

function cookieValue(
  headers: Pick<Headers, "get">,
  name: string,
): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator >= 0 && pair.slice(0, separator).trim() === name)
      return pair.slice(separator + 1).trim();
  }
  return null;
}

function scopedCookie(
  name: string,
  value: string,
  maximumAge: number,
  publicReference: string,
): string {
  return [
    `${name}=${value}`,
    `Path=/webinars/${encodeURIComponent(publicReference)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(maximumAge)}`,
    ...(secureEnvironment() ? ["Secure"] : []),
  ].join("; ");
}

export function eventVirtualJoinSessionCookie(
  token: string,
  publicReference: string,
): string {
  return scopedCookie(
    cookieName(publicReference),
    token,
    JOIN_SESSION_LIFETIME_MS / 1_000,
    publicReference,
  );
}

export function readEventVirtualJoinSessionCookie(
  headers: Pick<Headers, "get">,
  publicReference: string,
): string | null {
  const token = cookieValue(headers, cookieName(publicReference));
  return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
}

export async function issueEventVirtualGuestJoinSession(
  transaction: Transaction<Database>,
  input: {
    eventGuestAccessId: string;
    eventVirtualJoinAccessId: string;
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
    eventParticipationId: string;
    userId: string;
    now: Date;
  },
): Promise<string> {
  const token = opaqueReference(32);
  const joinSessionId = `event_virtual_join_session_${randomUUID()}`;
  await transaction
    .updateTable("event_virtual_join_session")
    .set({ revokedAt: input.now })
    .where("eventGuestAccessId", "=", input.eventGuestAccessId)
    .where("eventVirtualJoinAccessId", "=", input.eventVirtualJoinAccessId)
    .where("userId", "=", input.userId)
    .where("revokedAt", "is", null)
    .execute();
  await transaction
    .insertInto("event_virtual_join_session")
    .values({
      id: joinSessionId,
      challengeId: null,
      eventGuestAccessId: input.eventGuestAccessId,
      tokenDigest: secretDigest(`join:${token}`),
      eventVirtualJoinAccessId: input.eventVirtualJoinAccessId,
      eventOccurrenceId: input.eventOccurrenceId,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
      eventParticipationId: input.eventParticipationId,
      userId: input.userId,
      accessMethod: "guest",
      expiresAt: new Date(input.now.getTime() + JOIN_SESSION_LIFETIME_MS),
      lastUsedAt: input.now,
      revokedAt: null,
      createdAt: input.now,
    })
    .execute();
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_virtual_lobby.guest_access_issued",
    subjectType: "event_virtual_join_session",
    subjectId: joinSessionId,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      accessMethod: "guest",
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
    },
    createdAt: input.now,
  });
  return token;
}

export function eventVirtualChallengeCookie(
  reference: string,
  publicReference: string,
): string {
  return scopedCookie(
    challengeCookieName(publicReference),
    reference,
    CHALLENGE_LIFETIME_MS / 1_000,
    publicReference,
  );
}

export function clearEventVirtualChallengeCookie(
  publicReference: string,
): string {
  return scopedCookie(
    challengeCookieName(publicReference),
    "",
    0,
    publicReference,
  );
}

export function readEventVirtualChallengeCookie(
  request: Request,
  publicReference: string,
): string | null {
  const reference = cookieValue(
    request.headers,
    challengeCookieName(publicReference),
  );
  return reference && /^[A-Za-z0-9_-]{32}$/u.test(reference) ? reference : null;
}

export function eventVirtualRecoveryFingerprint(
  headers: Pick<Headers, "get">,
): string {
  return secretDigest(
    `event-virtual-recovery:${forwardedClientAddress(headers)}`,
  );
}

function requestFingerprint(): string {
  return eventVirtualRecoveryFingerprint(getRequestHeaders());
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

function consumeVerificationAuditLimit(
  fingerprint: string,
  store = verificationAuditLimits,
): boolean {
  return consumeFixedWindowRateLimit(
    store,
    `verification-audit:${fingerprint}`,
    Date.now(),
    {
      maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
      maximumRequests: VERIFICATION_AUDIT_MAXIMUM_WRITES,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  );
}

function consumeRequestAuditLimit(
  fingerprint: string,
  store = requestAuditLimits,
): boolean {
  return consumeFixedWindowRateLimit(
    store,
    `request-audit:${fingerprint}`,
    Date.now(),
    {
      maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
      maximumRequests: REQUEST_AUDIT_MAXIMUM_WRITES,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
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
      "occurrence.capacity as attendeeCapacity",
      "version.registrationSurveyVersionId",
      "session.title as sessionTitle",
      "session.startsAt",
      "session.endsAt",
      "session.livekitAdmissionMode",
      "session.livekitOpenEntryGuestsAllowed",
      "session.livekitAttendeeRejoinGraceMinutes",
      "session.livekitAttendeeRecordingNotice",
      "room.id as roomId",
      "room.providerRoomName",
      "room.doorState",
      "room.lockedAt",
      "room.admissionMode",
      "room.recordingMode",
      "room.providerStatus",
      "room.maxParticipants",
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
    .innerJoin("user", "user.id", "participation.userId")
    .select([
      "participation.id",
      "participation.userId",
      "participation.mode",
      "participation.registrationId",
      "participation.nameSnapshot",
      "participation.emailSnapshot",
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
    .executeTakeFirst();
  if (!participation) return null;
  if (participation.mode === "open_entry")
    return destination.livekitOpenEntryGuestsAllowed === true &&
      !participation.registrationId
      ? {
          ...participation,
          registrationStatus: null,
          questionnaireComplete: true,
        }
      : null;
  if (!participation.registrationId) return null;
  const registration = await connection
    .selectFrom("event_registration")
    .select("status")
    .where("id", "=", participation.registrationId)
    .where("eventOccurrenceId", "=", destination.eventOccurrenceId)
    .where("userId", "=", userId)
    .where("status", "=", "selected")
    .executeTakeFirst();
  if (!registration) return null;
  const eligible = {
    ...participation,
    registrationStatus: registration.status,
  };
  if (!destination.registrationSurveyVersionId)
    return { ...eligible, questionnaireComplete: true };
  const assignment = await connection
    .selectFrom("registration_questionnaire_assignment")
    .select("status")
    .where("eventOccurrenceId", "=", destination.eventOccurrenceId)
    .where("userId", "=", userId)
    .where("surveyVersionId", "=", destination.registrationSurveyVersionId)
    .executeTakeFirst();
  return {
    ...eligible,
    questionnaireComplete:
      assignment?.status === "completed" || assignment?.status === "waived",
  };
}

async function recoveredActor(
  destination: PublicDestination,
  tokenOverride?: string | null,
): Promise<VirtualLobbyActor | null> {
  const token = tokenOverride;
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const now = new Date();
  const idleAfter = new Date(now.getTime() - JOIN_SESSION_IDLE_MS);
  const row = await getDatabase()
    .selectFrom("event_virtual_join_session as joinSession")
    .innerJoin("user", "user.id", "joinSession.userId")
    .leftJoin(
      "event_guest_access as guestAccess",
      "guestAccess.id",
      "joinSession.eventGuestAccessId",
    )
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
    .where((expression) =>
      expression.or([
        expression("joinSession.accessMethod", "in", ["email", "sms"]),
        expression.and([
          expression("joinSession.accessMethod", "=", "guest"),
          expression(
            "guestAccess.eventOccurrenceId",
            "=",
            destination.eventOccurrenceId,
          ),
          expression("guestAccess.revokedAt", "is", null),
          expression("guestAccess.id", "is not", null),
        ]),
      ]),
    )
    .executeTakeFirst();
  if (!row) return null;
  const touched = await getDatabase()
    .updateTable("event_virtual_join_session")
    .set({ lastUsedAt: now })
    .where("id", "=", row.id)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  if (touched.numUpdatedRows !== 1n) return null;
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

async function lockRecoveredJoinSession(
  transaction: Transaction<Database>,
  destination: PublicDestination,
  actor: VirtualLobbyActor,
  now: Date,
): Promise<boolean> {
  if (actor.accessMethod === "authenticated") return true;
  if (!actor.joinSessionId || !actor.eventParticipationId) return false;
  const session = await transaction
    .selectFrom("event_virtual_join_session as joinSession")
    .leftJoin(
      "event_guest_access as guestAccess",
      "guestAccess.id",
      "joinSession.eventGuestAccessId",
    )
    .select("joinSession.id")
    .where("joinSession.id", "=", actor.joinSessionId)
    .where(
      "joinSession.eventVirtualJoinAccessId",
      "=",
      destination.eventVirtualJoinAccessId,
    )
    .where("joinSession.eventOccurrenceId", "=", destination.eventOccurrenceId)
    .where("joinSession.eventSessionId", "=", destination.eventSessionId)
    .where("joinSession.roomGeneration", "=", destination.roomGeneration)
    .where("joinSession.eventParticipationId", "=", actor.eventParticipationId)
    .where("joinSession.userId", "=", actor.user.id)
    .where("joinSession.accessMethod", "=", actor.accessMethod)
    .where("joinSession.expiresAt", ">", now)
    .where(
      "joinSession.lastUsedAt",
      ">",
      new Date(now.getTime() - JOIN_SESSION_IDLE_MS),
    )
    .where("joinSession.revokedAt", "is", null)
    .where((expression) =>
      expression.or([
        expression("joinSession.accessMethod", "in", ["email", "sms"]),
        expression.and([
          expression("joinSession.accessMethod", "=", "guest"),
          expression(
            "guestAccess.eventOccurrenceId",
            "=",
            destination.eventOccurrenceId,
          ),
          expression("guestAccess.revokedAt", "is", null),
          expression("guestAccess.id", "is not", null),
        ]),
      ]),
    )
    .forUpdate("joinSession")
    .executeTakeFirst();
  return Boolean(session);
}

async function resolveActor(
  destination: PublicDestination,
  authenticatedUser: AuthenticatedUser | null,
  tokenOverride?: string | null,
): Promise<VirtualLobbyActor | null> {
  const recovered = await recoveredActor(destination, tokenOverride);
  if (!authenticatedUser) return recovered;
  const authenticated = {
    user: authenticatedUser,
    accessMethod: "authenticated" as const,
  };
  if (!recovered || recovered.user.id === authenticatedUser.id)
    return authenticated;
  const recoveredParticipation = await eligibleParticipation(
    getDatabase(),
    destination,
    recovered.user.id,
  );
  return recoveredParticipation?.id === recovered.eventParticipationId
    ? recovered
    : authenticated;
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
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("status")
      .where("id", "=", destination.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (occurrence?.status !== "published") return "ineligible" as const;
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
    const now = new Date();
    if (!(await lockRecoveredJoinSession(transaction, destination, actor, now)))
      return "capability-revoked" as const;
    if (
      !(await lockEventVirtualAdmissionEligibility(transaction, {
        eventOccurrenceId: destination.eventOccurrenceId,
        eventParticipationId: participation.id,
        registrationSurveyVersionId: destination.registrationSurveyVersionId,
        openEntryGuestsAllowed:
          destination.livekitOpenEntryGuestsAllowed === true,
      }))
    )
      return "ineligible" as const;
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
        .select(["id", "state", "credentialExpiresAt"])
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
        await revokeEventVirtualLobbyEntryForEligibility(transaction, {
          entry: {
            ...entry,
            eventParticipationId: participation.id,
            state: entry.state as
              "waiting" | "admitted" | "token_issued" | "connected" | "left",
          },
          eventVirtualJoinAccessId: destination.eventVirtualJoinAccessId,
          eventOccurrenceId: destination.eventOccurrenceId,
          eventSessionId: destination.eventSessionId,
          roomId: destination.roomId,
          userId,
          now,
        });
        return;
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
  return recordingNoticeForMode(
    destination.recordingMode,
    destination.livekitAttendeeRecordingNotice,
  );
}

function recordingNoticeForMode(
  mode: PublicDestination["recordingMode"],
  configuredNotice: string | null,
): string | null {
  return mode === "automatic"
    ? configuredNotice?.trim() ||
        "This webinar will be recorded. By joining, you acknowledge the recording notice."
    : null;
}

function recordingDigest(notice: string): string {
  return createHash("sha256").update(notice).digest("base64url");
}

export async function resolveEventVirtualLobby(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  options: {
    joinSessionToken?: string | null;
    clock?: () => Date;
    beforeEnsureLobbyEntry?: () => Promise<void>;
  } = {},
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
  await options.beforeEnsureLobbyEntry?.();
  const entry = await ensureLobbyEntry(destination, actor, participation);
  if (entry === "capability-revoked") {
    if (authenticatedUser)
      return await resolveEventVirtualLobby(
        publicReference,
        authenticatedUser,
        {
          joinSessionToken: null,
          ...(options.clock ? { clock: options.clock } : {}),
        },
      );
    return {
      status: "ready",
      data: { ...empty, outcome: "authentication_required" },
    };
  }
  if (entry === "ineligible") {
    await revokeIneligibleLobbyAccess(destination, actor.user.id);
    return { status: "ready", data: { ...empty, outcome: "revoked" } };
  }
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

interface RecoveryAuditTarget {
  subjectType: string;
  subjectId: string;
  aggregateId: string;
  eventSessionId?: string;
  roomGeneration?: number;
}

type AttendeeCredentialDenialReason = Extract<
  EventVirtualAttendeeCredentialResult,
  { status: "conflict" }
>["reason"];
type AttendeeCredentialAuditDenialReason =
  AttendeeCredentialDenialReason | "unauthenticated";

function privateRecoveryAuditTarget(
  subjectType:
    "event_virtual_recovery_request" | "event_virtual_recovery_verification",
  ...references: string[]
): RecoveryAuditTarget {
  const subjectId = `${subjectType}_${secretDigest(
    `audit:${subjectType}:${references.join(":")}`,
  )}`;
  return { subjectType, subjectId, aggregateId: subjectId };
}

function recoveryAuditTargetForDestination(
  destination: PublicDestination,
): RecoveryAuditTarget {
  return {
    subjectType: "event_virtual_join_access",
    subjectId: destination.eventVirtualJoinAccessId,
    aggregateId: destination.eventOccurrenceId,
    eventSessionId: destination.eventSessionId,
    roomGeneration: destination.roomGeneration,
  };
}

async function recordRecoveryRequestOutcome(
  transaction: Transaction<Database>,
  input: {
    target: RecoveryAuditTarget;
    channel: "email" | "sms" | null;
    responseStatus: "accepted" | "invalid" | "rate-limited" | "unavailable";
    reasonCode: string;
    createdAt?: Date;
  },
): Promise<void> {
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_virtual_lobby.recovery_request_outcome",
    subjectType: input.target.subjectType,
    subjectId: input.target.subjectId,
    aggregateId: input.target.aggregateId,
    reasonCode: input.reasonCode,
    metadata: {
      channel: input.channel,
      responseStatus: input.responseStatus,
      eventSessionId: input.target.eventSessionId,
      roomGeneration: input.target.roomGeneration,
    },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

async function recordStandaloneRecoveryRequestOutcome(
  input: Parameters<typeof recordRecoveryRequestOutcome>[1],
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute((transaction) => recordRecoveryRequestOutcome(transaction, input));
}

interface RecoveryRequestAuditContext {
  fingerprint: string;
  store?: Map<string, FixedWindowRateLimitEntry>;
}

async function recordLimitedRecoveryRequestOutcome(
  transaction: Transaction<Database>,
  input: Parameters<typeof recordRecoveryRequestOutcome>[1],
  audit: RecoveryRequestAuditContext,
): Promise<void> {
  if (!consumeRequestAuditLimit(audit.fingerprint, audit.store)) return;
  await recordRecoveryRequestOutcome(transaction, input);
}

async function recordLimitedStandaloneRecoveryRequestOutcome(
  input: Parameters<typeof recordRecoveryRequestOutcome>[1],
  audit: RecoveryRequestAuditContext,
): Promise<void> {
  if (!consumeRequestAuditLimit(audit.fingerprint, audit.store)) return;
  await recordStandaloneRecoveryRequestOutcome(input);
}

async function recordAttendeeCredentialDenial(
  transaction: Transaction<Database>,
  input: {
    target: RecoveryAuditTarget;
    actorUserId: string | null;
    reasonCode: AttendeeCredentialAuditDenialReason;
    phase:
      | "actor_revalidation"
      | "lobby_decision"
      | "provider_configuration"
      | "provider_preflight"
      | "transaction_revalidation";
    createdAt?: Date;
  },
): Promise<void> {
  if (
    !consumeFixedWindowRateLimit(
      credentialDenialAuditLimits,
      [
        "credential-denial",
        input.target.subjectType,
        input.target.subjectId,
        input.reasonCode,
        input.phase,
      ].join(":"),
      Date.now(),
      {
        maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
        maximumRequests: 1,
        windowMs: RATE_LIMIT_WINDOW_MS,
      },
    )
  )
    return;
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: "event_virtual_lobby.attendee_token_denied",
    subjectType: input.target.subjectType,
    subjectId: input.target.subjectId,
    aggregateId: input.target.aggregateId,
    reasonCode: input.reasonCode,
    metadata: {
      responseStatus:
        input.reasonCode === "unauthenticated" ? "unauthenticated" : "conflict",
      phase: input.phase,
      eventSessionId: input.target.eventSessionId,
      roomGeneration: input.target.roomGeneration,
    },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

async function recordStandaloneAttendeeCredentialDenial(
  input: Parameters<typeof recordAttendeeCredentialDenial>[1],
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute((transaction) =>
      recordAttendeeCredentialDenial(transaction, input),
    );
}

async function recordLobbyDecisionCredentialDenial(
  publicReference: string,
  actorUserId: string | null,
  reasonCode: AttendeeCredentialDenialReason,
): Promise<void> {
  const destination = await findPublicDestination(
    getDatabase(),
    publicReference,
  );
  if (!destination) return;
  await recordStandaloneAttendeeCredentialDenial({
    target: recoveryAuditTargetForDestination(destination),
    actorUserId,
    reasonCode,
    phase: "lobby_decision",
  });
}

async function recordRecoveryVerificationFailure(
  transaction: Transaction<Database>,
  input: {
    target: RecoveryAuditTarget;
    responseStatus: "expired" | "invalid" | "rate-limited";
    reasonCode: string;
    createdAt?: Date;
  },
): Promise<void> {
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_virtual_lobby.recovery_verification_failed",
    subjectType: input.target.subjectType,
    subjectId: input.target.subjectId,
    aggregateId: input.target.aggregateId,
    reasonCode: input.reasonCode,
    metadata: {
      responseStatus: input.responseStatus,
      eventSessionId: input.target.eventSessionId,
      roomGeneration: input.target.roomGeneration,
    },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

async function recordLimitedRecoveryVerificationFailure(
  transaction: Transaction<Database>,
  input: Parameters<typeof recordRecoveryVerificationFailure>[1],
  audit: {
    fingerprint: string;
    store?: Map<string, FixedWindowRateLimitEntry>;
  },
): Promise<void> {
  if (!consumeVerificationAuditLimit(audit.fingerprint, audit.store)) return;
  await recordRecoveryVerificationFailure(transaction, input);
}

export async function recordEventVirtualRecoveryVerificationInputRejected(
  publicReference: string,
  fingerprint = secretDigest(`verification-internal:${publicReference}`),
  overrides: RecoveryVerificationAuditOverrides = {},
): Promise<void> {
  if (!consumeVerificationAuditLimit(fingerprint, overrides.auditLimitStore))
    return;
  const target = privateRecoveryAuditTarget(
    "event_virtual_recovery_verification",
    publicReference,
    "invalid-submission",
  );
  await getDatabase()
    .transaction()
    .execute((transaction) =>
      recordRecoveryVerificationFailure(transaction, {
        target,
        responseStatus: "invalid",
        reasonCode: "invalid_submission",
      }),
    );
}

export async function recordEventVirtualRecoveryRequestInputRejected(
  publicReference: string,
  fingerprint = secretDigest(`request-internal:${publicReference}`),
  overrides: RecoveryRequestAuditOverrides = {},
): Promise<void> {
  if (!consumeRequestAuditLimit(fingerprint, overrides.auditLimitStore)) return;
  const target = privateRecoveryAuditTarget(
    "event_virtual_recovery_request",
    publicReference,
    "invalid-submission",
  );
  await getDatabase()
    .transaction()
    .execute((transaction) =>
      recordRecoveryRequestOutcome(transaction, {
        target,
        channel: null,
        responseStatus: "invalid",
        reasonCode: "invalid_submission",
      }),
    );
}

export async function requestEventVirtualRecoveryCode(
  input: { publicReference: string; identifier: string },
  fingerprintOverride?: string,
  requestOverrides: RecoveryRequestOverrides = {},
): Promise<EventVirtualRecoveryRequestResult> {
  const database = getDatabase();
  const phone = normalizeInternationalPhone(input.identifier);
  const channel = phone ? ("sms" as const) : ("email" as const);
  const normalizedIdentifier = phone ?? normalizeEmail(input.identifier);
  const identifierDigest = secretDigest(`${channel}:${normalizedIdentifier}`);
  const fingerprint = fingerprintOverride ?? requestFingerprint();
  const requestAudit: RecoveryRequestAuditContext = {
    fingerprint,
    ...(requestOverrides.auditLimitStore
      ? { store: requestOverrides.auditLimitStore }
      : {}),
  };
  if (
    !consumeRequestLimit(
      input.publicReference,
      identifierDigest,
      fingerprint,
      requestOverrides.requestLimitStore,
    )
  ) {
    await recordLimitedStandaloneRecoveryRequestOutcome(
      {
        target: privateRecoveryAuditTarget(
          "event_virtual_recovery_request",
          input.publicReference,
        ),
        channel,
        responseStatus: "rate-limited",
        reasonCode: "local_rate_limited",
      },
      requestAudit,
    );
    return { status: "rate-limited" };
  }
  const destination = await findPublicDestination(
    database,
    input.publicReference,
  );
  const requestAuditTarget = destination
    ? recoveryAuditTargetForDestination(destination)
    : privateRecoveryAuditTarget(
        "event_virtual_recovery_request",
        input.publicReference,
      );
  if (
    !destination?.publishedAt ||
    destination.occurrenceStatus !== "published"
  ) {
    await recordLimitedStandaloneRecoveryRequestOutcome(
      {
        target: requestAuditTarget,
        channel,
        responseStatus: "unavailable",
        reasonCode: "destination_unavailable",
      },
      requestAudit,
    );
    return { status: "unavailable" };
  }
  if (isTerminalDestination(destination, new Date())) {
    await recordLimitedStandaloneRecoveryRequestOutcome(
      {
        target: requestAuditTarget,
        channel,
        responseStatus: "unavailable",
        reasonCode: "terminal_session",
      },
      requestAudit,
    );
    return { status: "unavailable" };
  }
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
  if (!participant) {
    await recordLimitedStandaloneRecoveryRequestOutcome(
      {
        target: requestAuditTarget,
        channel,
        responseStatus: "accepted",
        reasonCode: "enumeration_safe_fallback",
      },
      requestAudit,
    );
    return { status: "accepted", challengeReference: fallbackReference };
  }
  const eligibility = await eligibleParticipation(
    database,
    destination,
    participant.userId,
  );
  if (!eligibility?.questionnaireComplete) {
    await recordLimitedStandaloneRecoveryRequestOutcome(
      {
        target: requestAuditTarget,
        channel,
        responseStatus: "accepted",
        reasonCode: "enumeration_safe_fallback",
      },
      requestAudit,
    );
    return { status: "accepted", challengeReference: fallbackReference };
  }
  const challengeId = `event_virtual_recovery_${randomUUID()}`;
  const challengeReference = opaqueReference();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await requestOverrides.beforeReserve?.();
  const reserved = await database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`event-virtual-recovery:${destination.eventVirtualJoinAccessId}:${identifierDigest}`}, 0
    ))`.execute(transaction);
    const reservedAt = new Date();
    const currentTarget = await lockEligibleRecoveryTarget(transaction, {
      eventVirtualJoinAccessId: destination.eventVirtualJoinAccessId,
      eventOccurrenceId: destination.eventOccurrenceId,
      eventSessionId: destination.eventSessionId,
      roomGeneration: destination.roomGeneration,
      eventParticipationId: participant.id,
      userId: participant.userId,
      channel,
      recipientAddress: normalizedIdentifier,
      publicReference: input.publicReference,
      now: reservedAt,
    });
    if (!currentTarget) {
      await recordLimitedRecoveryRequestOutcome(
        transaction,
        {
          target: requestAuditTarget,
          channel,
          responseStatus: "accepted",
          reasonCode: "eligibility_changed",
          createdAt: reservedAt,
        },
        requestAudit,
      );
      return false;
    }
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
    if (Number(recent.count) >= 3) {
      await recordLimitedRecoveryRequestOutcome(
        transaction,
        {
          target: requestAuditTarget,
          channel,
          responseStatus: "accepted",
          reasonCode: "durable_rate_limited",
          createdAt: reservedAt,
        },
        requestAudit,
      );
      return false;
    }
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
    await enqueueEventVirtualRecoveryDelivery(transaction, {
      challengeId,
      recipientAddress: normalizedIdentifier,
      code,
      createdAt: reservedAt,
    });
    await recordLimitedRecoveryRequestOutcome(
      transaction,
      {
        target: requestAuditTarget,
        channel,
        responseStatus: "accepted",
        reasonCode: "challenge_queued",
        createdAt: reservedAt,
      },
      requestAudit,
    );
    return true;
  });
  if (!reserved)
    return { status: "accepted", challengeReference: fallbackReference };
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

export async function verifyEventVirtualRecoveryCode(
  input: {
    publicReference: string;
    challengeReference: string;
    code: string;
  },
  fingerprint = secretDigest(`verification-internal:${input.publicReference}`),
  overrides: RecoveryVerificationAuditOverrides = {},
): Promise<EventVirtualRecoveryVerificationResult> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const audit = {
      fingerprint,
      ...(overrides.auditLimitStore
        ? { store: overrides.auditLimitStore }
        : {}),
    };
    const privateAuditTarget = privateRecoveryAuditTarget(
      "event_virtual_recovery_verification",
      input.publicReference,
      input.challengeReference,
    );
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
    if (!locator) {
      await recordLimitedRecoveryVerificationFailure(
        transaction,
        {
          target: privateAuditTarget,
          responseStatus: "invalid",
          reasonCode: "invalid_reference",
        },
        audit,
      );
      return { status: "invalid" };
    }
    const verificationAuditTarget: RecoveryAuditTarget = {
      subjectType: "event_virtual_recovery_challenge",
      subjectId: locator.id,
      aggregateId: locator.eventOccurrenceId,
      eventSessionId: locator.eventSessionId,
      roomGeneration: locator.roomGeneration,
    };
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
    ) {
      await recordLimitedRecoveryVerificationFailure(
        transaction,
        {
          target: verificationAuditTarget,
          responseStatus: "expired",
          reasonCode: "expired_or_revoked",
          createdAt: now,
        },
        audit,
      );
      return { status: "expired" };
    }
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
      await recordLimitedRecoveryVerificationFailure(
        transaction,
        {
          target: verificationAuditTarget,
          responseStatus: "expired",
          reasonCode: "terminal_session",
          createdAt: now,
        },
        audit,
      );
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
      await recordLimitedRecoveryVerificationFailure(
        transaction,
        {
          target: verificationAuditTarget,
          responseStatus: "expired",
          reasonCode: "eligibility_changed",
          createdAt: now,
        },
        audit,
      );
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
      const responseStatus = attempts >= 5 ? "rate-limited" : "invalid";
      await recordLimitedRecoveryVerificationFailure(
        transaction,
        {
          target: verificationAuditTarget,
          responseStatus,
          reasonCode:
            responseStatus === "rate-limited"
              ? "attempt_limit_reached"
              : "incorrect_code",
          createdAt: now,
        },
        audit,
      );
      return { status: responseStatus };
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
        responseStatus: "ready",
      },
      createdAt: now,
    });
    return { status: "ready", joinSessionToken: token };
  });
}

async function actorAndEntry(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  joinSessionToken?: string | null,
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
  joinSessionToken?: string | null,
): Promise<EventVirtualLobbyMutationResult> {
  const database = getDatabase();
  const initialDestination = await findPublicDestination(
    database,
    publicReference,
  );
  if (!initialDestination) return { status: "not-found" };
  const actor = await resolveActor(
    initialDestination,
    authenticatedUser,
    joinSessionToken,
  );
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

export async function issueEventVirtualAttendeeCredential(
  publicReference: string,
  authenticatedUser: AuthenticatedUser | null,
  options: {
    provider?: LiveKitProvider;
    websocketUrl?: string;
    joinSessionToken?: string | null;
  } = {},
): Promise<EventVirtualAttendeeCredentialResult> {
  const status = await resolveEventVirtualLobby(
    publicReference,
    authenticatedUser,
    { joinSessionToken: options.joinSessionToken ?? null },
  );
  if (status.status === "not-found") return { status: "not-found" };
  if (status.data.outcome === "authentication_required")
    return { status: "unauthenticated" };
  if (status.data.outcome !== "ready_to_join") {
    const reason =
      status.data.outcome === "declined" ? "revoked" : status.data.outcome;
    await recordLobbyDecisionCredentialDenial(
      publicReference,
      authenticatedUser?.id ?? null,
      reason,
    );
    return {
      status: "conflict",
      reason,
    };
  }
  const resolved = await actorAndEntry(
    publicReference,
    authenticatedUser,
    options.joinSessionToken,
  );
  if (!resolved) return { status: "not-found" };
  if (!resolved.actor) return { status: "unauthenticated" };
  if (!resolved.entry) {
    await recordStandaloneAttendeeCredentialDenial({
      target: recoveryAuditTargetForDestination(resolved.destination),
      actorUserId: resolved.actor.user.id,
      reasonCode: "revoked",
      phase: "actor_revalidation",
    });
    return { status: "conflict", reason: "revoked" };
  }
  const credentialAuditTarget: RecoveryAuditTarget = {
    subjectType: "event_virtual_lobby_entry",
    subjectId: resolved.entry.id,
    aggregateId: resolved.destination.eventOccurrenceId,
    eventSessionId: resolved.destination.eventSessionId,
    roomGeneration: resolved.destination.roomGeneration,
  };
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
    !resolved.destination.providerRoomName ||
    !resolved.destination.maxParticipants
  ) {
    await recordStandaloneAttendeeCredentialDenial({
      target: credentialAuditTarget,
      actorUserId: resolved.actor.user.id,
      reasonCode: "provider_unavailable",
      phase: "provider_configuration",
    });
    return { status: "conflict", reason: "provider_unavailable" };
  }
  const providerRoomName = resolved.destination.providerRoomName;
  const participantIdentity = eventVirtualAttendeeIdentity(
    resolved.destination.roomId,
    resolved.participation.id,
  );
  let credential;
  try {
    const participants = await provider.listParticipants(providerRoomName);
    if (
      !participants.some(
        (participant) => participant.identity === participantIdentity,
      ) &&
      (participants.length >= resolved.destination.maxParticipants ||
        participants.filter((participant) =>
          isEventVirtualAttendeeIdentity(participant.identity),
        ).length >= resolved.destination.attendeeCapacity)
    ) {
      await recordStandaloneAttendeeCredentialDenial({
        target: credentialAuditTarget,
        actorUserId: resolved.actor.user.id,
        reasonCode: "capacity_reached",
        phase: "provider_preflight",
      });
      return { status: "conflict", reason: "capacity_reached" };
    }
    credential = await provider.createJoinToken({
      roomName: providerRoomName,
      participantIdentity,
      displayName:
        resolved.participation.nameSnapshot.trim().slice(0, 200) || "Attendee",
      role: "attendee",
    });
  } catch (error) {
    if (error instanceof LiveKitProviderError) {
      await recordStandaloneAttendeeCredentialDenial({
        target: credentialAuditTarget,
        actorUserId: resolved.actor.user.id,
        reasonCode: "provider_unavailable",
        phase: "provider_preflight",
      });
      return { status: "conflict", reason: "provider_unavailable" };
    }
    throw error;
  }
  const lobbyEntryId = resolved.entry.id;
  const issuance = await getDatabase()
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
        .select([
          "id",
          "doorState",
          "providerStatus",
          "recordingMode",
          "maxParticipants",
        ])
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
      const notice = recordingNoticeForMode(
        room?.recordingMode ?? resolved.destination.recordingMode,
        resolved.destination.livekitAttendeeRecordingNotice,
      );
      let denialReason: AttendeeCredentialAuditDenialReason | null = null;
      if (
        occurrence &&
        (["cancelled", "completed"].includes(occurrence.status) ||
          room?.doorState === "ended" ||
          ((!room || room.doorState === "scheduled") &&
            resolved.destination.endsAt <= revalidationNow))
      )
        denialReason = "ended";
      else if (!access || !occurrence || occurrence.status !== "published")
        denialReason = "revoked";
      else if (
        resolved.actor.accessMethod !== "authenticated" &&
        !recoveredJoinSession
      )
        denialReason = "unauthenticated";
      else if (!participation) denialReason = "revoked";
      else if (!participation.questionnaireComplete)
        denialReason = "questionnaire_required";
      else if (!entry || ["declined", "revoked"].includes(entry.state))
        denialReason = "revoked";
      else if (!room || room.doorState === "scheduled")
        denialReason = "meeting_not_started";
      else if (
        room.doorState === "locked" &&
        !canJoinThroughDoor(
          room.doorState,
          resolved.destination.livekitAttendeeRejoinGraceMinutes,
          entry,
          revalidationNow,
        )
      )
        denialReason = "locked";
      else if (entry.state === "waiting")
        denialReason = "waiting_for_admission";
      else if (
        !["admitted", "token_issued", "connected", "left"].includes(entry.state)
      )
        denialReason = "revoked";
      else if (
        notice &&
        entry.recordingNoticeDigest !== recordingDigest(notice)
      )
        denialReason = "recording_acknowledgement_required";
      else if (room.providerStatus !== "ready")
        denialReason = "provider_unavailable";
      if (denialReason) {
        await recordAttendeeCredentialDenial(transaction, {
          target: credentialAuditTarget,
          actorUserId: resolved.actor.user.id,
          reasonCode: denialReason,
          phase: "transaction_revalidation",
          createdAt: revalidationNow,
        });
        return denialReason === "unauthenticated"
          ? ({ status: "unauthenticated" } as const)
          : ({ status: "conflict", reason: denialReason } as const);
      }
      if (!room || !entry)
        throw new Error("Accepted attendee credential state is incomplete");
      try {
        const participants = await provider.listParticipants(providerRoomName);
        const connectedIdentities = new Set(
          participants.map((participant) => participant.identity),
        );
        if (!connectedIdentities.has(participantIdentity)) {
          const unconnectedReservations =
            await countUnconnectedVirtualCredentialReservations(transaction, {
              roomId: room.id,
              eventSessionId: resolved.destination.eventSessionId,
              roomGeneration: resolved.destination.roomGeneration,
              connectedIdentities,
              now: revalidationNow,
              excludingLobbyEntryId: entry.id,
            });
          if (
            participants.length + unconnectedReservations.total >=
              room.maxParticipants ||
            participants.filter((participant) =>
              isEventVirtualAttendeeIdentity(participant.identity),
            ).length +
              unconnectedReservations.attendees >=
              resolved.destination.attendeeCapacity
          ) {
            await recordAttendeeCredentialDenial(transaction, {
              target: credentialAuditTarget,
              actorUserId: resolved.actor.user.id,
              reasonCode: "capacity_reached",
              phase: "transaction_revalidation",
              createdAt: revalidationNow,
            });
            return {
              status: "conflict",
              reason: "capacity_reached",
            } as const;
          }
        }
      } catch (error) {
        if (error instanceof LiveKitProviderError) {
          await recordAttendeeCredentialDenial(transaction, {
            target: credentialAuditTarget,
            actorUserId: resolved.actor.user.id,
            reasonCode: "provider_unavailable",
            phase: "transaction_revalidation",
            createdAt: revalidationNow,
          });
          return {
            status: "conflict",
            reason: "provider_unavailable",
          } as const;
        }
        throw error;
      }
      const now = revalidationNow;
      const nextState =
        entry.state === "connected" ? "connected" : "token_issued";
      const credentialExpiresAt =
        entry.credentialExpiresAt &&
        entry.credentialExpiresAt > credential.expiresAt
          ? entry.credentialExpiresAt
          : credential.expiresAt;
      await transaction
        .updateTable("event_virtual_lobby_entry")
        .set({
          state: nextState,
          firstTokenIssuedAt: entry.firstTokenIssuedAt ?? now,
          credentialExpiresAt,
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
      return { status: "ready", credential } as const;
    });
  if (issuance.status !== "ready") return issuance;
  return {
    status: "ready",
    credential: {
      token: issuance.credential.token,
      websocketUrl,
      expiresAt: issuance.credential.expiresAt.toISOString(),
      generation: resolved.destination.roomGeneration,
    },
  };
}

async function changeAdmission(
  transaction: Transaction<Database>,
  destination: PublicDestination,
  entryId: string,
  action: "admit" | "decline" | "revoke",
  actorUserId: string | null,
  now: Date,
): Promise<"ready" | "not-found" | "invalid-transition" | "ineligible"> {
  const candidate = await transaction
    .selectFrom("event_virtual_lobby_entry")
    .select(["id", "eventParticipationId", "state"])
    .where("id", "=", entryId)
    .where(
      "eventVirtualJoinAccessId",
      "=",
      destination.eventVirtualJoinAccessId,
    )
    .executeTakeFirst();
  if (!candidate) return "not-found";
  if (
    action === "admit" &&
    ["admitted", "token_issued", "connected"].includes(candidate.state)
  )
    return "ready";
  if (action === "admit" && candidate.state !== "waiting")
    return "invalid-transition";
  if (
    action === "admit" &&
    !(await lockEventVirtualAdmissionEligibility(transaction, {
      eventOccurrenceId: destination.eventOccurrenceId,
      eventParticipationId: candidate.eventParticipationId,
      registrationSurveyVersionId: destination.registrationSurveyVersionId,
      openEntryGuestsAllowed:
        destination.livekitOpenEntryGuestsAllowed === true,
    }))
  )
    return "ineligible";
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
  if (
    action === "revoke" &&
    destination.roomId &&
    (["token_issued", "connected", "left"].includes(entry.state) ||
      (entry.credentialExpiresAt?.getTime() ?? 0) > now.getTime())
  )
    await enqueueEventVirtualParticipantRemoval(transaction, {
      roomId: destination.roomId,
      lobbyEntryId: entry.id,
      participantIdentity: eventVirtualAttendeeIdentity(
        destination.roomId,
        entry.eventParticipationId,
      ),
      credentialExpiresAt: entry.credentialExpiresAt ?? now,
      requestedByUserId: actorUserId,
      now,
    });
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
  options: {
    admissionBatchSize?: number;
    clock?: () => Date;
    afterAdmissionBatch?: (outcome: {
      admittedCount: number;
      hasMore: boolean;
    }) => Promise<void>;
  } = {},
): Promise<EventVirtualLobbyMutationResult> {
  const database = getDatabase();
  const outcome = await database.transaction().execute(async (transaction) => {
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
    const now = options.clock?.() ?? new Date();
    if (isTerminalDestination(destination, now))
      return { status: "conflict", reason: "session_ended" } as const;
    if (input.action === "admit_all")
      return {
        status: "admit-all",
        roomGeneration: room.generation,
      } as const;
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
  if (outcome.status !== "admit-all") return outcome;
  await admitEligibleWaitingEntries(
    database,
    {
      eventOccurrenceId: input.eventOccurrenceId,
      eventSessionId: input.eventSessionId,
      roomGeneration: outcome.roomGeneration,
      actorUserId: user.id,
      source: "staff_admit_all",
    },
    {
      ...(options.admissionBatchSize
        ? { batchSize: options.admissionBatchSize }
        : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.afterAdmissionBatch
        ? { afterBatch: options.afterAdmissionBatch }
        : {}),
    },
  );
  return { status: "ready" };
}
