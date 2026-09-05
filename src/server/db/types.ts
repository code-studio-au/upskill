import type { ColumnType, Generated } from "kysely";
import type { CertificateAccreditation } from "#/features/catalog/accreditation";
import type { OfferingImage } from "#/features/shared/offering-image";
import type { BulkPricing } from "#/features/catalog/catalog.schema";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type Json = ColumnType<unknown, unknown, unknown>;
type JsonDocument<T> = ColumnType<T, string | undefined, string>;
type NullableJsonDocument<T> = ColumnType<
  T | null,
  string | null | undefined,
  string | null
>;

interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  emailEnabled: Generated<boolean>;
  emailVerifiedAt: OptionalTimestamp;
  image: string | null;
  stripeCustomerId: string | null;
  accountState: Generated<"provisional" | "active">;
  provisioningSource: Generated<
    | "administrator"
    | "open_entry"
    | "late_invitation"
    | "access_owner"
    | "self_purchase"
    | null
  >;
  provisionedByUserId: Generated<string | null>;
  setupRequestedAt: OptionalTimestamp;
  activatedAt: OptionalTimestamp;
  phone: string | null;
  smsEnabled: Generated<boolean>;
  smsVerifiedAt: OptionalTimestamp;
  currentRegionId: string | null;
  profileData: Json;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface SessionTable {
  id: string;
  expiresAt: Timestamp;
  token: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}

interface AccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Timestamp | null;
  refreshTokenExpiresAt: Timestamp | null;
  scope: string | null;
  password: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface OrganizationTable {
  id: string;
  name: string;
  slug: string;
  createdAt: Timestamp;
}

interface OrganizationMemberTable {
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "manager" | "learner";
  createdAt: Timestamp;
}

interface EnterpriseContractTable {
  id: string;
  organizationId: string;
  reference: string;
  name: string;
  status: "draft" | "active" | "suspended" | "terminated";
  startsAt: Timestamp;
  expiresAt: Timestamp;
  enrollmentDurationDays: number;
  autoEnrollCourses: Generated<boolean>;
  renewedFromEnterpriseContractId: Generated<string | null>;
  createdByUserId: string;
  createdAt: Timestamp;
  activatedAt: Timestamp | null;
  suspendedAt: Timestamp | null;
  terminatedAt: Timestamp | null;
  terminatedByUserId: string | null;
}

interface EnterpriseContractCourseCoverageTable {
  id: string;
  enterpriseContractId: string;
  courseId: string;
  courseTitleSnapshot: string;
  createdAt: Timestamp;
}

interface EnterpriseContractDomainTable {
  enterpriseContractId: string;
  domain: string;
  createdAt: Timestamp;
}

interface EnterpriseContractEventCoverageTable {
  id: string;
  enterpriseContractId: string;
  eventOccurrenceId: string;
  eventTitleSnapshot: string;
  createdAt: Timestamp;
}

interface EnterpriseContractEmployeeEligibilityTable {
  id: string;
  enterpriseContractId: string;
  email: string;
  name: string | null;
  importedByUserId: string;
  importedAt: Timestamp;
  removedAt: Timestamp | null;
  removedByUserId: string | null;
}

interface EnterpriseContractOwnerAssignmentTable {
  id: string;
  enterpriseContractId: string;
  userId: string;
  invitedEmail: string;
  invitedByUserId: string;
  invitedAt: Timestamp;
  activatedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EnterpriseContractCodeTable {
  id: string;
  enterpriseContractId: string;
  lookupId: string;
  encryptedAccessCode: string;
  createdByUserId: string;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EnterpriseContractClaimTable {
  id: string;
  enterpriseContractId: string;
  userId: string;
  emailSnapshot: string;
  informationReleaseNoticeVersion: string;
  informationReleaseAcceptedAt: Timestamp;
  claimedAt: Timestamp;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EnterpriseContractEventRegistrationTable {
  id: string;
  enterpriseContractId: string;
  enterpriseContractClaimId: string;
  enterpriseContractEventCoverageId: string;
  eventRegistrationId: string;
  userId: string;
  registeredAt: Timestamp;
}

interface PlatformAdminTable {
  userId: string;
  grantedByUserId: string | null;
  createdAt: Timestamp;
}

interface PlatformAdminInvitationTable {
  id: string;
  userId: string;
  invitedByUserId: string;
  invitedAt: Timestamp;
  acceptedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  cancelledByUserId: string | null;
}

interface EventStaffEligibilityTable {
  id: string;
  userId: string;
  responsibility: "presenter" | "coordinator";
  regionId: string | null;
  grantedByUserId: string | null;
  grantedAt: Timestamp;
  revokedByUserId: string | null;
  revokedAt: Timestamp | null;
}

interface CourseTable {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface CourseVersionTable {
  id: string;
  courseId: string;
  version: number;
  content: Json;
  registrationSurveyVersionId: Generated<string | null>;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface CourseVersionSectionTable {
  id: string;
  courseVersionId: string;
  position: number;
  title: string;
  description: string;
  createdAt: Timestamp;
}

interface CourseVersionItemTable {
  id: string;
  courseVersionId: string;
  sectionId: string;
  position: number;
  kind: "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  modulePosition: number | null;
  learningActivityVersionId: string;
  createdAt: Timestamp;
}

interface LearningActivityTable {
  id: string;
  kind: "scorm" | "survey" | "resource";
  title: string;
  surveyUsage: Generated<"learning" | "onboarding" | "registration" | null>;
  surveyType: Generated<
    "system" | "registration" | "elearning" | "event" | "shared" | null
  >;
  surveyPosition: Generated<number | null>;
  createdAt: Timestamp;
}

interface OnboardingDefinitionTable {
  id: string;
  name: string;
  createdAt: Timestamp;
}

interface OnboardingDefinitionVersionTable {
  id: string;
  definitionId: string;
  version: number;
  surveyVersionId: string;
  privacyNotice: string;
  privacyNoticeVersion: string;
  profileMappings: Json;
  contactVerificationRequired: Generated<boolean>;
  publishedAt: Timestamp;
  activatedAt: Timestamp | null;
  deactivatedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface OnboardingAssignmentTable {
  id: string;
  userId: string;
  definitionVersionId: string;
  status: "assigned" | "in_progress" | "completed" | "superseded";
  source: "automatic" | "administrator" | "campaign";
  assignedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  supersededAt: Timestamp | null;
  verificationDeferredAt: OptionalTimestamp;
  verificationSkippedAt: OptionalTimestamp;
}

interface OnboardingResponseTable {
  id: string;
  assignmentId: string;
  surveyVersionId: string;
  answers: Json;
  visitedItemIds: Json;
  currentItemId: string | null;
  startedAt: Timestamp;
  updatedAt: Timestamp;
  submittedAt: Timestamp | null;
  redactedAt: Timestamp | null;
}

interface LearningActivityVersionTable {
  id: string;
  activityId: string;
  kind: "scorm" | "survey" | "resource";
  version: number;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface SurveyVersionTable {
  id: string;
  kind: Generated<"survey">;
  content: Json;
}

interface SurveyResponseTable {
  id: string;
  enrollmentId: string | null;
  courseVersionItemId: string | null;
  eventParticipationId: Generated<string | null>;
  eventTemplateVersionItemId: Generated<string | null>;
  surveyVersionId: string;
  answers: Json;
  submittedAt: Timestamp;
}

interface SurveyProgressTable {
  id: string;
  enrollmentId: string | null;
  courseVersionItemId: string | null;
  eventParticipationId: Generated<string | null>;
  eventTemplateVersionItemId: Generated<string | null>;
  surveyVersionId: string;
  answers: Json;
  visitedItemIds: Json;
  currentItemId: string | null;
  startedAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

interface LearningResourceVersionTable {
  id: string;
  kind: Generated<"resource">;
  displayName: string;
  description: string;
  objectKey: string;
  sha256: string;
  sourceBytes: number;
  mediaType: "application/pdf";
}

interface ScormPackageVersionTable {
  id: string;
  kind: Generated<"scorm">;
  status: "quarantined" | "processing" | "ready" | "rejected";
  standard: "scorm-1.2";
  contentPrefix: string;
  launchPath: string;
  sha256: string;
  manifest: Json;
  sourceBytes: Generated<number | null>;
  failureCode: Generated<string | null>;
  processedAt: ColumnType<
    Date | null,
    Date | string | null | undefined,
    Date | string | null
  >;
}

interface EnrollmentTable {
  id: string;
  userId: string;
  courseVersionId: string;
  accessGrantId: string | null;
  status: "active" | "completed" | "expired" | "cancelled";
  enrolledAt: Timestamp;
  completedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  removedAt: Timestamp | null;
}

interface ScormAttemptTable {
  id: string;
  enrollmentId: string | null;
  modulePosition: number | null;
  eventParticipationId: Generated<string | null>;
  eventTemplateVersionItemId: Generated<string | null>;
  scormPackageVersionId: string;
  attemptNumber: number;
  status: "not_started" | "in_progress" | "completed" | "abandoned";
  lessonStatus:
    | "not_attempted"
    | "incomplete"
    | "completed"
    | "passed"
    | "failed"
    | "browsed";
  location: string;
  suspendData: string;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  totalTimeSeconds: number;
  startedAt: Timestamp | null;
  lastActivityAt: Timestamp | null;
  completedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface ScormLaunchTokenTable {
  digest: string;
  attemptId: string;
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface ScormAttemptSessionTable {
  digest: string;
  attemptId: string;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface ScormAttemptContextTable {
  attemptId: string;
  userId: string;
  enrollmentId: string | null;
  enrollmentStatus: EnrollmentTable["status"] | null;
  enrollmentExpiresAt: Date | null;
  removedAt: Date | null;
  eventParticipationId: string | null;
  occurrenceStatus: EventOccurrenceTable["status"] | null;
  participationMode: EventParticipationTable["mode"] | null;
  registrationStatus: EventRegistrationTable["status"] | null;
}

interface LearningProgressOverrideTable {
  id: string;
  sequence: Generated<number>;
  enrollmentId: string;
  scope: "module" | "enrollment";
  modulePosition: number | null;
  state: "completed" | "incomplete";
  actorUserId: string;
  reason: string | null;
  createdAt: Timestamp;
}

interface LearningItemProgressTable {
  id: string;
  enrollmentId: string | null;
  courseVersionItemId: string | null;
  eventParticipationId: Generated<string | null>;
  eventTemplateVersionItemId: Generated<string | null>;
  state: "completed";
  completedAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventTemplateTable {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventTemplateVersionTable {
  id: string;
  eventTemplateId: string;
  version: number;
  topic: Generated<string>;
  summary: string;
  description: string;
  coverImage: NullableJsonDocument<NonNullable<OfferingImage>>;
  hasCompletionCertificate: boolean;
  accreditations: JsonDocument<Array<CertificateAccreditation>>;
  registrationSurveyVersionId: Generated<string | null>;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface RegistrationQuestionnaireAssignmentTable {
  id: string;
  userId: string;
  surveyVersionId: string;
  eventOccurrenceId: string | null;
  eventOccurrenceRegionId: string | null;
  enrollmentId: string | null;
  status: "assigned" | "in_progress" | "completed" | "waived";
  assignedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  waivedAt: Timestamp | null;
  waivedByUserId: string | null;
  waiverReason: string | null;
}

interface RegistrationQuestionnaireResponseTable {
  id: string;
  assignmentId: string;
  surveyVersionId: string;
  answers: Json;
  visitedItemIds: Json;
  currentItemId: string | null;
  startedAt: Timestamp;
  updatedAt: Timestamp;
  submittedAt: Timestamp | null;
  profileUpdateAcceptedAt: Timestamp | null;
  redactedAt: Timestamp | null;
}

interface AccreditationLogoAssetTable {
  id: string;
  displayName: string;
  objectKey: string;
  mediaType: "image/png" | "image/jpeg";
  sourceBytes: number;
  sha256: string;
  createdByUserId: string;
  createdAt: Timestamp;
}

interface OfferingImageAssetTable {
  id: string;
  displayName: string;
  objectKey: string;
  mediaType: "image/png" | "image/jpeg";
  sourceBytes: number;
  sha256: string;
  createdByUserId: string;
  createdAt: Timestamp;
}

interface CoordinationRegionTable {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: Generated<"group" | "operational">;
  status: "active" | "retired";
  createdAt: Timestamp;
}

interface EventTemplateVersionRegionTable {
  eventTemplateVersionId: string;
  regionId: string;
  position: number;
}

interface EventTemplateVersionAdminDefaultTable {
  eventTemplateVersionId: string;
  userId: string;
  createdAt: Timestamp;
}

interface EventTemplateVersionCoordinatorDefaultTable {
  eventTemplateVersionId: string;
  regionId: string;
  userId: string;
  createdAt: Timestamp;
}

interface EventTemplateSessionDefinitionTable {
  id: string;
  eventTemplateVersionId: string;
  position: number;
  title: string;
  durationMinutes: number;
  presenterRequired: boolean;
  livekitAdmissionMode: Generated<"manual" | "automatic">;
  livekitAttendanceMode: Generated<
    "manual" | "automatic_check_in" | "automatic_duration"
  >;
  livekitAttendanceMinimumMinutes: number | null;
  livekitPresenterPreparationMinutes: Generated<number>;
  livekitAttendeeRejoinGraceMinutes: Generated<number>;
  livekitCapacityHeadroom: Generated<number>;
  livekitOpenEntryGuestsAllowed: Generated<boolean>;
  livekitRecordingMode: Generated<"off" | "automatic">;
  livekitRecordingRetentionDays: number | null;
  livekitAttendeeRecordingNotice: Generated<string>;
  livekitPresenterRecordingNotice: Generated<string>;
  createdAt: Timestamp;
}

interface EventTemplateVersionPresenterDefaultTable {
  eventTemplateVersionId: string;
  sessionDefinitionId: string | null;
  userId: string;
  scopeKey: string;
  createdAt: Timestamp;
}

interface EventTemplateVersionSectionTable {
  id: string;
  eventTemplateVersionId: string;
  position: number;
  title: string;
  description: string;
  phase: "pre_event" | "session" | "post_event" | "follow_up";
  releaseAnchor:
    | "participation_created"
    | "occurrence_start"
    | "occurrence_end"
    | "final_session_end";
  releaseOffsetAmount: number;
  releaseOffsetUnit: "minute" | "hour" | "day" | "week" | "month";
  createdAt: Timestamp;
}

interface EventTemplateVersionItemTable {
  id: string;
  eventTemplateVersionId: string;
  sectionId: string;
  position: number;
  kind: "session" | "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  learningActivityVersionId: string | null;
  sessionDefinitionId: string | null;
  createdAt: Timestamp;
}

interface EventOccurrenceTable {
  id: string;
  eventTemplateVersionId: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "cancelled" | "completed" | "archived";
  deliveryMode: "in_person" | "virtual";
  virtualDeliveryProvider: Generated<"external_url" | "livekit" | null>;
  registrationMode:
    | "open_entry"
    | "paid_entry"
    | "required_unrestricted"
    | "required_restricted";
  approvalMode: "automatic" | "manual";
  timezone: string;
  localStartsAt: string;
  localEndsAt: string;
  localRegistrationOpensAt: string | null;
  localRegistrationClosesAt: string | null;
  localCoordinatorLockAt: string | null;
  startsAt: Timestamp;
  endsAt: Timestamp;
  registrationOpensAt: Timestamp | null;
  registrationClosesAt: Timestamp | null;
  coordinatorLockAt: Timestamp | null;
  capacity: number;
  confirmedCount: Generated<number>;
  venueName: string | null;
  venueAddress: string | null;
  virtualJoinUrl: string | null;
  priceCents: number | null;
  salePriceCents: number | null;
  currency: "AUD";
  bulkPricing: JsonDocument<BulkPricing>;
  listInStore: boolean;
  featured: boolean;
  openEntryAttendanceMode: Generated<"checked_in" | "attended">;
  administratorAttentionRequired: Generated<boolean>;
  coordinatorAttentionRequired: Generated<boolean>;
  presenterAttentionRequired: Generated<boolean>;
  publishedAt: Timestamp | null;
  createdByUserId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventOccurrenceDomainTable {
  eventOccurrenceId: string;
  domain: string;
  createdAt: Timestamp;
}

interface EventOccurrenceRegionTable {
  id: string;
  eventOccurrenceId: string;
  regionId: string;
  position: number;
  retiredAt: Timestamp | null;
}

interface EventSessionTable {
  id: string;
  eventOccurrenceId: string;
  sessionDefinitionId: string;
  position: number;
  title: string;
  localStartsAt: string;
  localEndsAt: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  presenterRequired: boolean;
  venueName: string | null;
  venueAddress: string | null;
  virtualJoinUrl: string | null;
  virtualDeliveryProvider: Generated<"external_url" | "livekit" | null>;
  livekitAdmissionMode: Generated<"manual" | "automatic" | null>;
  livekitAttendanceMode: Generated<
    "manual" | "automatic_check_in" | "automatic_duration" | null
  >;
  livekitAttendanceMinimumMinutes: Generated<number | null>;
  livekitPresenterPreparationMinutes: Generated<number | null>;
  livekitAttendeeRejoinGraceMinutes: Generated<number | null>;
  livekitCapacityHeadroom: Generated<number | null>;
  livekitOpenEntryGuestsAllowed: Generated<boolean | null>;
  livekitRecordingMode: Generated<"off" | "automatic" | null>;
  livekitRecordingRetentionDays: Generated<number | null>;
  livekitAttendeeRecordingNotice: Generated<string | null>;
  livekitPresenterRecordingNotice: Generated<string | null>;
}

interface EventVirtualRoomTable {
  id: string;
  eventSessionId: string;
  provider: "livekit";
  generation: number;
  providerRoomName: string;
  providerRoomSid: string | null;
  doorState: "scheduled" | "open" | "locked" | "ended";
  admissionMode: "manual" | "automatic";
  attendanceMode: "manual" | "automatic_check_in" | "automatic_duration";
  attendanceMinimumMinutes: number | null;
  recordingMode: "off" | "automatic";
  recordingRetentionDays: number | null;
  maxParticipants: number;
  providerStatus: "pending" | "ready" | "error" | "closed";
  providerErrorCode: string | null;
  createdByUserId: string;
  createdAt: Timestamp;
  startedByUserId: string | null;
  startedAt: Timestamp | null;
  lockedByUserId: string | null;
  lockedAt: Timestamp | null;
  reopenedByUserId: string | null;
  reopenedAt: Timestamp | null;
  endedByUserId: string | null;
  endedAt: Timestamp | null;
  replacesRoomId: string | null;
  replacedByUserId: string | null;
  replacedAt: Timestamp | null;
}

interface EventVirtualRoomOperationTable {
  id: string;
  roomId: string;
  kind: "ensure_room" | "close_room" | "remove_participant";
  targetKey: Generated<string>;
  lobbyEntryId: Generated<string | null>;
  participantIdentity: Generated<string | null>;
  deduplicationKey: string;
  status: "pending" | "processing" | "succeeded";
  attempts: Generated<number>;
  availableAt: Timestamp;
  leasedUntil: Timestamp | null;
  lastAttemptAt: Timestamp | null;
  completedAt: Timestamp | null;
  lastErrorCode: string | null;
  requestedByUserId: string | null;
  createdAt: Timestamp;
}

interface EventVirtualJoinAccessTable {
  id: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
  publicReference: string;
  lobbyRevision: Generated<number>;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EventVirtualLobbyEntryTable {
  id: string;
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
  eventParticipationId: string;
  state:
    | "waiting"
    | "admitted"
    | "token_issued"
    | "connected"
    | "left"
    | "declined"
    | "revoked";
  accessMethod: "authenticated" | "email" | "sms";
  requestedAt: Timestamp;
  admittedAt: Timestamp | null;
  admittedByUserId: string | null;
  declinedAt: Timestamp | null;
  declinedByUserId: string | null;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
  firstTokenIssuedAt: Timestamp | null;
  credentialExpiresAt: OptionalTimestamp;
  recordingAcknowledgedAt: Timestamp | null;
  recordingNoticeDigest: string | null;
  firstConnectedAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  leftAt: Timestamp | null;
  updatedAt: Timestamp;
}

interface EventVirtualRecoveryChallengeTable {
  id: string;
  reference: string;
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
  eventParticipationId: string;
  userId: string;
  channel: "email" | "sms";
  identifierDigest: string;
  requestFingerprint: string;
  codeDigest: string;
  attempts: Generated<number>;
  resendCount: Generated<number>;
  deliveryStatus: "pending" | "sent" | "failed" | "unknown";
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface EventVirtualJoinSessionTable {
  id: string;
  challengeId: string;
  tokenDigest: string;
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
  eventParticipationId: string;
  userId: string;
  accessMethod: "email" | "sms";
  expiresAt: Timestamp;
  lastUsedAt: Timestamp;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface EventVirtualRecoveryEmailCaptureTable {
  challengeId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  createdAt: Timestamp;
}

interface EventVirtualRecoverySmsCaptureTable {
  challengeId: string;
  recipientPhone: string;
  message: string;
  createdAt: Timestamp;
}

type EventAssignmentSource =
  "template_default" | "occurrence_local" | "replacement";

interface EventAdminAssignmentTable {
  id: string;
  eventOccurrenceId: string;
  userId: string;
  source: EventAssignmentSource;
  assignedByUserId: string;
  assignedAt: Timestamp;
  endedAt: Timestamp | null;
  endReason:
    | "assignment_ended"
    | "platform_admin_revoked"
    | "user_disabled"
    | "replaced"
    | null;
}

interface EventCoordinatorAssignmentTable {
  id: string;
  eventOccurrenceRegionId: string;
  userId: string;
  source: EventAssignmentSource;
  assignedByUserId: string;
  assignedAt: Timestamp;
  endedAt: Timestamp | null;
  endReason: "assignment_ended" | "user_disabled" | "replaced" | null;
}

interface EventPresenterAssignmentTable {
  id: string;
  eventOccurrenceId: string;
  eventSessionId: string | null;
  userId: string;
  scopeKey: string;
  source: EventAssignmentSource;
  assignedByUserId: string;
  assignedAt: Timestamp;
  endedAt: Timestamp | null;
  endReason: "assignment_ended" | "user_disabled" | "replaced" | null;
}

interface EventRegionReviewRoundTable {
  id: string;
  eventOccurrenceRegionId: string;
  round: number;
  registrationClosesAt: Timestamp;
  coordinatorLockAt: Timestamp;
  lockedAt: Timestamp | null;
  lockedByUserId: string | null;
  lockSource: "manual" | "deadline" | "administrator" | null;
  eventOccurrenceRescheduleId: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
}

interface EventOccurrenceRescheduleTable {
  id: string;
  eventOccurrenceId: string;
  registrationWindowPolicy: "keep" | "replace_future" | "reopen";
  previousTimezone: string;
  previousLocalStartsAt: string;
  previousLocalEndsAt: string;
  previousLocalRegistrationOpensAt: string | null;
  previousLocalRegistrationClosesAt: string | null;
  previousLocalCoordinatorLockAt: string | null;
  previousStartsAt: Timestamp;
  previousEndsAt: Timestamp;
  previousRegistrationOpensAt: Timestamp | null;
  previousRegistrationClosesAt: Timestamp | null;
  previousCoordinatorLockAt: Timestamp | null;
  nextTimezone: string;
  nextLocalStartsAt: string;
  nextLocalEndsAt: string;
  nextLocalRegistrationOpensAt: string | null;
  nextLocalRegistrationClosesAt: string | null;
  nextLocalCoordinatorLockAt: string | null;
  nextStartsAt: Timestamp;
  nextEndsAt: Timestamp;
  nextRegistrationOpensAt: Timestamp | null;
  nextRegistrationClosesAt: Timestamp | null;
  nextCoordinatorLockAt: Timestamp | null;
  actorUserId: string;
  createdAt: Timestamp;
}

interface EventOccurrenceRescheduleRegionTable {
  eventOccurrenceRescheduleId: string;
  eventOccurrenceRegionId: string;
  coverageAction: "retained" | "added" | "retired";
  registrationDisposition: "future_only" | "cancel_registrations" | null;
}

interface EventOccurrenceRescheduleRegionCoordinatorTable {
  eventOccurrenceRescheduleId: string;
  eventOccurrenceRegionId: string;
  userId: string;
}

interface EventRegistrationTable {
  id: string;
  eventOccurrenceId: string;
  userId: string;
  eventOccurrenceRegionId: string | null;
  reviewRoundId: string | null;
  nameSnapshot: string;
  emailSnapshot: string;
  source:
    | "ordinary"
    | "paid_checkout"
    | "access_code"
    | "enterprise_contract"
    | "late_invitation"
    | "administrator_override";
  eligibilitySource:
    | "unrestricted"
    | "paid"
    | "access_code"
    | "enterprise_contract"
    | "verified_domain"
    | "administrator_override";
  status:
    | "submitted"
    | "coordinator_approved"
    | "coordinator_declined"
    | "selected"
    | "waitlisted"
    | "not_selected"
    | "withdrawn"
    | "cancelled";
  coordinatorPriority: number | null;
  submittedAt: Timestamp;
  coordinatorDecidedAt: Timestamp | null;
  coordinatorDecidedByUserId: string | null;
  finalDecidedAt: Timestamp | null;
  finalDecidedByUserId: string | null;
  lockedInAt: Timestamp | null;
  regionMismatchAcknowledgedProfileRegionId: Generated<string | null>;
  regionMismatchAcknowledgedAt: OptionalTimestamp;
  regionMismatchAcknowledgedByUserId: Generated<string | null>;
  regionalReviewWaivedAt: OptionalTimestamp;
  regionalReviewWaivedByUserId: Generated<string | null>;
}

interface EventRegistrationTransitionTable {
  id: string;
  eventRegistrationId: string;
  fromStatus: EventRegistrationTable["status"] | null;
  toStatus: EventRegistrationTable["status"];
  fromEventOccurrenceRegionId: Generated<string | null>;
  toEventOccurrenceRegionId: Generated<string | null>;
  source:
    "learner" | "automatic" | "coordinator" | "administrator" | "deadline";
  actorUserId: string | null;
  priority: number | null;
  occurredAt: Timestamp;
}

interface EventRegistrationRegionDecisionTable {
  id: string;
  eventRegistrationId: string;
  registrationEventOccurrenceRegionId: string | null;
  resolution:
    | "registered_region_confirmed"
    | "profile_region_confirmed"
    | "profile_aligned_to_registration"
    | "region_guest_confirmed";
  classification: "event_region" | "outside_event_region" | "no_region_guest";
  reportingRegionId: string | null;
  reportingRegionCodeSnapshot: string | null;
  reportingRegionNameSnapshot: string | null;
  reportingRegionGroupCodeSnapshot: string | null;
  reportingRegionGroupNameSnapshot: string | null;
  decidedByUserId: string;
  decidedAt: Timestamp;
  supersededAt: Timestamp | null;
}

interface EventLateRegistrationInvitationTable {
  id: string;
  eventOccurrenceId: string;
  userId: string;
  eventOccurrenceRegionId: string | null;
  recipientNameSnapshot: string;
  recipientEmailSnapshot: string;
  tokenDigest: string;
  overrideDomainRestriction: boolean;
  expiresAt: Timestamp;
  createdByUserId: string;
  createdAt: Timestamp;
  acceptedAt: Timestamp | null;
  acceptedRegistrationId: string | null;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EventParticipationTable {
  id: string;
  eventOccurrenceId: string;
  userId: string;
  registrationId: string | null;
  mode: "registered" | "open_entry";
  nameSnapshot: string;
  emailSnapshot: string;
  detailsSubmittedAt: Timestamp | null;
  joinDisclosedAt: Timestamp | null;
  checkedInAt: Timestamp | null;
  privacyAcceptedAt: OptionalTimestamp;
  privacyNoticeVersion: Generated<string | null>;
  completedAt: OptionalTimestamp;
  createdAt: Timestamp;
}

interface EventAccessRedemptionTable {
  id: string;
  accessGrantId: string;
  accessGrantCodeId: string | null;
  eventRegistrationId: string;
  eventParticipationId: string;
  userId: string;
  redemptionEmailSnapshot: string;
  informationReleaseNoticeVersion: string;
  informationReleaseAcceptedAt: Timestamp;
  redeemedAt: Timestamp;
}

interface EventGuestAccessTable {
  id: string;
  eventOccurrenceId: string;
  publicReference: string;
  generation: Generated<number>;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
}

interface EventAttendanceTable {
  eventParticipationId: string;
  eventSessionId: string;
  state: "not_recorded" | "checked_in" | "attended" | "absent";
  source:
    "system" | "self_check_in" | "coordinator" | "presenter" | "administrator";
  recordedByUserId: string | null;
  recordedAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventSectionReleaseTable {
  eventParticipationId: string;
  eventTemplateVersionSectionId: string;
  releasedAt: Timestamp;
}

interface EventSurveyAccessTable {
  id: string;
  eventOccurrenceId: string;
  eventTemplateVersionItemId: string;
  publicReference: string;
  generation: Generated<number>;
  accessPolicy: Generated<"authenticated_participant">;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
}

interface EventPrerequisiteRecoveryChallengeTable {
  id: string;
  reference: string;
  eventSurveyAccessId: string;
  eventParticipationId: string;
  userId: string;
  identifierDigest: string;
  requestFingerprint: string;
  codeDigest: string;
  deliveryChannel: Generated<"email" | "sms">;
  attempts: Generated<number>;
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface EventPrerequisiteTaskSessionTable {
  id: string;
  challengeId: string;
  tokenDigest: string;
  eventSurveyAccessId: string;
  eventParticipationId: string;
  userId: string;
  expiresAt: Timestamp;
  lastUsedAt: Timestamp;
  completedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface EventPrerequisiteEmailCaptureTable {
  challengeId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  createdAt: Timestamp;
}

interface EventPrerequisiteSmsCaptureTable {
  challengeId: string;
  recipientPhone: string;
  message: string;
  createdAt: Timestamp;
}

interface ContactVerificationChallengeTable {
  id: string;
  reference: string;
  assignmentId: string | null;
  userId: string;
  purpose: Generated<"onboarding" | "profile">;
  channel: "email" | "sms";
  destinationDigest: string;
  codeDigest: string;
  attempts: Generated<number>;
  expiresAt: Timestamp;
  consumedAt: OptionalTimestamp;
  createdAt: Timestamp;
}

interface ContactVerificationEmailCaptureTable {
  challengeId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  createdAt: Timestamp;
}

interface ContactVerificationSmsCaptureTable {
  challengeId: string;
  recipientPhone: string;
  message: string;
  createdAt: Timestamp;
}

interface SmsDeliveryTable {
  id: string;
  purpose:
    | "event_prerequisite_recovery"
    | "event_virtual_recovery"
    | "onboarding_contact_verification"
    | "profile_contact_verification";
  recipientPhone: string;
  recipientUserId: Generated<string | null>;
  recipientNameSnapshot: Generated<string | null>;
  provider: "local_capture" | "textbee";
  providerBatchId: string | null;
  status: Generated<
    "pending" | "accepted" | "sent" | "delivered" | "failed" | "unknown"
  >;
  lastErrorCode: string | null;
  acceptedAt: OptionalTimestamp;
  sentAt: OptionalTimestamp;
  deliveredAt: OptionalTimestamp;
  failedAt: OptionalTimestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface PhoneVerificationClaimTable {
  id: string;
  phone: string;
  userId: string;
  verificationChallengeId: string | null;
  claimedAt: Timestamp;
  releasedAt: OptionalTimestamp;
  releaseReason:
    | "transferred"
    | "reverified"
    | "phone_changed"
    | "migration_duplicate"
    | null;
  createdAt: Timestamp;
}

interface SmsDeliveryWebhookEventTable {
  id: string;
  providerEventId: string | null;
  eventType:
    | "MESSAGE_SENT"
    | "MESSAGE_DELIVERED"
    | "MESSAGE_FAILED"
    | "UNKNOWN_STATE"
    | "SMS_STATUS_UPDATED";
  providerBatchId: string | null;
  matchedDeliveryId: string | null;
  payloadDigest: string;
  receivedAt: Timestamp;
}

interface OrderTable {
  id: string;
  purchaserUserId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  kind: Generated<
    | "individual_purchase"
    | "bulk_purchase"
    | "capacity_extension"
    | "event_registration"
  >;
  status: "pending" | "paid" | "failed" | "partially_refunded" | "refunded";
  currency: string;
  totalCents: number;
  refundedCents: Generated<number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface OrderItemTable {
  id: string;
  orderId: string;
  courseVersionId: string | null;
  eventOccurrenceId: string | null;
  quantity: number;
  unitPriceCents: number;
  enrollmentDurationDays: number | null;
  createdAt: Timestamp;
}

interface BulkOrderTable {
  orderId: string;
  accessGrantId: string | null;
  organizationName: string;
  grantLabel: string;
  fulfillmentMode: "shared_code" | "single_use_codes";
  codePrefix: string;
  customerExtendable: Generated<boolean>;
  createdAt: Timestamp;
}

interface OrderRefundTable {
  stripeRefundId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  reason: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface AccessGrantTable {
  id: string;
  organizationId: string | null;
  orderId: string | null;
  courseVersionId: string | null;
  eventOccurrenceId: string | null;
  label: Generated<string | null>;
  createdByUserId: Generated<string | null>;
  enrollmentDurationDays: number | null;
  quantity: number;
  redeemed: Generated<number>;
  expiresAt: Timestamp | null;
  revokedAt: OptionalTimestamp;
  revokedByUserId: Generated<string | null>;
  createdAt: Timestamp;
  kind: Generated<
    "bulk_purchase" | "enterprise_contract" | "individual_purchase"
  >;
  customerExtendable: Generated<boolean>;
  fulfillmentMode: Generated<"shared_code" | "single_use_codes" | null>;
  codePrefix: Generated<string | null>;
}

interface AccessGrantCodeTable {
  id: string;
  accessGrantId: string;
  lookupId: string;
  encryptedAccessCode: string;
  ordinal: number | null;
  createdAt: Timestamp;
}

interface AccessGrantOwnerAssignmentTable {
  id: string;
  accessGrantId: string;
  userId: string;
  invitedEmail: string;
  invitedByUserId: string;
  invitedAt: Timestamp;
  activatedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  revokedByUserId: string | null;
}

interface EntitlementTable {
  id: string;
  userId: string;
  courseVersionId: string;
  enrollmentId: string;
  originType:
    "access_grant" | "order" | "administrator" | "enterprise_contract";
  originAccessGrantId: string | null;
  originAccessGrantCodeId: string | null;
  originOrderId: string | null;
  originEnterpriseContractId: Generated<string | null>;
  originEnterpriseContractClaimId: Generated<string | null>;
  originEnterpriseContractCoverageId: Generated<string | null>;
  redemptionEmailSnapshot: string;
  informationReleaseNoticeVersion: string | null;
  informationReleaseAcceptedAt: Timestamp | null;
  grantedAt: Timestamp;
  revokedAt: Timestamp | null;
}

interface AccessGrantDomainTable {
  accessGrantId: string;
  domain: string;
  createdAt: Timestamp;
}

interface OutboxEventTable {
  id: string;
  topic: string;
  aggregateId: string;
  payload: Json;
  attempts: Generated<number>;
  availableAt: Timestamp;
  processedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface NotificationTable {
  id: string;
  channel: "email";
  templateKey:
    | "account_setup_requested"
    | "phone_verification_transferred"
    | "offering_course"
    | "offering_event";
  recipientUserId: string;
  recipientName: string;
  recipientEmail: string;
  emailDesignVersionId: string;
  subjectTemplateSnapshot: string;
  textBodyTemplateSnapshot: string;
  accountSetupVerificationId: Generated<string | null>;
  status: Generated<
    "pending" | "processing" | "delivered" | "failed" | "superseded" | "unknown"
  >;
  deduplicationKey: string;
  payload: Json;
  attempts: Generated<number>;
  lastErrorCode: string | null;
  deliveredAt: Timestamp | null;
  supersededAt: Timestamp | null;
  renderedSubject: string | null;
  renderedTextBody: string | null;
  renderedHtmlBody: string | null;
  renderedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventCommunicationScheduleTable {
  id: string;
  logicalId: string;
  revision: number;
  eventOccurrenceId: string;
  eventOccurrenceCommunicationRevisionId: string;
  trigger:
    | "event_end"
    | "event_start"
    | "post_event_incomplete"
    | "prework_incomplete"
    | "session_start";
  dueAt: Timestamp;
  status: Generated<
    "pending" | "processing" | "completed" | "failed" | "superseded"
  >;
  attempts: Generated<number>;
  availableAt: Timestamp;
  lastErrorCode: string | null;
  recipientCount: number | null;
  processedAt: Timestamp | null;
  supersededAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventOperationalCommunicationScheduleTable {
  id: string;
  logicalId: string;
  revision: number;
  eventOccurrenceId: string;
  eventRegionReviewRoundId: string;
  kind: "regional_review_due" | "regional_lock_due";
  dueAt: Timestamp;
  status: Generated<
    "pending" | "processing" | "completed" | "failed" | "superseded"
  >;
  attempts: Generated<number>;
  availableAt: Timestamp;
  lastErrorCode: string | null;
  recipientCount: number | null;
  processedAt: Timestamp | null;
  supersededAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface NotificationDeliveryAttemptTable {
  id: string;
  notificationId: string;
  attempt: number;
  provider: string;
  status: "delivered" | "failed" | "unknown";
  providerMessageId: string | null;
  errorCode: string | null;
  createdAt: Timestamp;
}

interface EmailDeliveryCaptureTable {
  notificationId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  createdAt: Timestamp;
}

interface EmailDesignTable {
  id: string;
  catalogue: "offering" | "system";
  name: string;
  contextKey:
    | "system_account_setup"
    | "system_phone_verification"
    | "offering_course"
    | "offering_event";
  position: number;
  systemKey: string | null;
  activeVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EmailDesignVersionTable {
  id: string;
  emailDesignId: string;
  version: number;
  contractKey: string;
  contractVersion: number;
  subject: string;
  textBody: string;
  referencedVariables: Json;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

type CommunicationOffsetUnit = "minute" | "hour" | "day" | "week";
type CourseCommunicationAudience = "active_enrollees" | "affected_learner";
type CourseCommunicationTrigger =
  | "course_incomplete"
  | "enrollment_completed"
  | "enrollment_created"
  | "enrollment_expiring";
type EventCommunicationAudience =
  | "active_registrants"
  | "administrators"
  | "affected_learner"
  | "confirmed_participants"
  | "coordinators"
  | "presenters";
type EventCommunicationTrigger =
  | "event_completed"
  | "event_end"
  | "event_start"
  | "event_cancelled"
  | "event_rescheduled"
  | "post_event_incomplete"
  | "prework_incomplete"
  | "registration_cancelled"
  | "registration_not_selected"
  | "registration_selected"
  | "registration_submitted"
  | "registration_waitlisted"
  | "section_release"
  | "session_start";

interface CourseVersionCommunicationTable {
  id: string;
  courseVersionId: string;
  sectionId: string | null;
  position: number;
  label: string;
  emailDesignVersionId: string;
  audience: CourseCommunicationAudience;
  trigger: CourseCommunicationTrigger;
  offsetAmount: number;
  offsetUnit: CommunicationOffsetUnit;
  subjectOverride: string | null;
  textBodyOverride: string | null;
  createdByUserId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventTemplateVersionCommunicationTable {
  id: string;
  eventTemplateVersionId: string;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  position: number;
  label: string;
  emailDesignVersionId: string;
  audience: EventCommunicationAudience;
  trigger: EventCommunicationTrigger;
  offsetAmount: number;
  offsetUnit: CommunicationOffsetUnit;
  subjectOverride: string | null;
  textBodyOverride: string | null;
  createdByUserId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EventOccurrenceCommunicationRevisionTable {
  id: string;
  logicalId: string;
  eventOccurrenceId: string;
  sourceTemplateCommunicationId: string;
  revision: number;
  active: boolean;
  overrideState: "inherited" | "overridden";
  emailDesignVersionId: string;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  position: number;
  label: string;
  audience: EventCommunicationAudience;
  trigger: EventCommunicationTrigger;
  offsetAmount: number;
  offsetUnit: CommunicationOffsetUnit;
  subject: string;
  textBody: string;
  createdByUserId: string | null;
  createdAt: Timestamp;
}

export type AuditEventAction =
  | "access_grant.owner_activated"
  | "access_grant.owner_assigned"
  | "access_grant.owner_code_revealed"
  | "access_grant.owner_revoked"
  | "access_grant.administrator_capacity_updated"
  | "access_grant.administrator_code_revealed"
  | "access_grant.administrator_created"
  | "access_grant.administrator_revoked"
  | "authorization.platform_admin.bootstrapped"
  | "authorization.platform_admin.granted"
  | "authorization.platform_admin.invitation_cancelled"
  | "authorization.platform_admin.invited"
  | "authorization.platform_admin.revoked"
  | "course.archived"
  | "course.created"
  | "course.deleted"
  | "course.published"
  | "course.version_created"
  | "communication_plan.created"
  | "communication_plan.deleted"
  | "communication_plan.overridden"
  | "communication_plan.reset"
  | "communication_plan.updated"
  | "email_design.created"
  | "email_design.draft_created"
  | "email_design.draft_deleted"
  | "email_design.published"
  | "email_design.reordered"
  | "email_design.rolled_back"
  | "enterprise_contract.activated"
  | "enterprise_contract.bulk_enrollment_completed"
  | "enterprise_contract.claimed"
  | "enterprise_contract.code_rotated"
  | "enterprise_contract.code_revealed"
  | "enterprise_contract.created"
  | "enterprise_contract.eligibility_replaced"
  | "enterprise_contract.entitlement_issued"
  | "enterprise_contract.event_registered"
  | "enterprise_contract.owner_activated"
  | "enterprise_contract.owner_assigned"
  | "enterprise_contract.owner_revoked"
  | "enterprise_contract.renewed"
  | "enterprise_contract.report_exported"
  | "enterprise_contract.resumed"
  | "enterprise_contract.suspended"
  | "enterprise_contract.terminated"
  | "event_occurrence.created"
  | "event_occurrence.guest_access_rotated"
  | "event_occurrence.updated"
  | "event_occurrence.published"
  | "event_occurrence.lifecycle_changed"
  | "event_occurrence.rescheduled"
  | "event_participation.completed"
  | "event_participation.completion_revoked"
  | "event_staff.eligibility_granted"
  | "event_staff.eligibility_revoked"
  | "coordination_region.created"
  | "coordination_region.updated"
  | "coordination_region.retired"
  | "coordination_region.reactivated"
  | "event_attendance.recorded"
  | "event_late_registration_invitation.accepted"
  | "event_late_registration_invitation.created"
  | "event_late_registration_invitation.revoked"
  | "event_prerequisite.recovery_verified"
  | "event_region_review.locked"
  | "event_registration.administrator_added"
  | "event_registration.coordinator_reviewed"
  | "event_registration.final_decided"
  | "event_registration.region_mismatch_acknowledged"
  | "event_registration.region_decided"
  | "event_registration.region_reassigned"
  | "event_registration.submitted"
  | "event_registration.withdrawn"
  | "event_template.created"
  | "event_template.draft_deleted"
  | "event_template.version_created"
  | "event_template.version_published"
  | "event_virtual_room.created"
  | "event_virtual_room.lifecycle_changed"
  | "event_virtual_room.presenter_token_issued"
  | "event_virtual_join_access.created"
  | "event_virtual_join_access.revoked"
  | "event_virtual_lobby.requested"
  | "event_virtual_lobby.admission_changed"
  | "event_virtual_lobby.recovery_verified"
  | "event_virtual_lobby.attendee_token_issued"
  | "enrollment.access_code_redeemed"
  | "enrollment.administrator_added"
  | "enrollment.administrator_removed"
  | "enrollment.learning_completed"
  | "enrollment.purchased"
  | "enrollment.scorm_completed"
  | "entitlement.information_release_accepted"
  | "learning.progress_overridden"
  | "notification.delivery_requeued"
  | "order.checkout_failed"
  | "order.checkout_paid"
  | "order.paid_existing_enrollment"
  | "order.refund_recorded"
  | "resource.uploaded"
  | "resource.version_removed"
  | "registration_questionnaire.waived"
  | "scorm.attempt_launch_issued"
  | "scorm.package_ready"
  | "scorm.package_rejected"
  | "scorm.package_uploaded"
  | "scorm.package_version_removed"
  | "survey.created"
  | "survey.published"
  | "survey.reordered"
  | "survey.version_created"
  | "user.provisional_created"
  | "user.account_activated"
  | "user.account_setup_resent"
  | "user.onboarding_reassigned"
  | "user.phone_verification_transferred"
  | "user.region_updated";

interface AuditEventTable {
  id: string;
  actorUserId: string | null;
  action: AuditEventAction;
  subjectType: string;
  subjectId: string;
  reason: string | null;
  metadata: Json;
  createdAt: Timestamp;
}

export interface Database {
  accreditation_logo_asset: AccreditationLogoAssetTable;
  offering_image_asset: OfferingImageAssetTable;
  account: AccountTable;
  access_grant: AccessGrantTable;
  access_grant_code: AccessGrantCodeTable;
  access_grant_domain: AccessGrantDomainTable;
  access_grant_owner_assignment: AccessGrantOwnerAssignmentTable;
  audit_event: AuditEventTable;
  course: CourseTable;
  course_version: CourseVersionTable;
  course_version_communication: CourseVersionCommunicationTable;
  course_version_item: CourseVersionItemTable;
  course_version_section: CourseVersionSectionTable;
  coordination_region: CoordinationRegionTable;
  enrollment: EnrollmentTable;
  entitlement: EntitlementTable;
  enterprise_contract: EnterpriseContractTable;
  enterprise_contract_claim: EnterpriseContractClaimTable;
  enterprise_contract_code: EnterpriseContractCodeTable;
  enterprise_contract_course_coverage: EnterpriseContractCourseCoverageTable;
  enterprise_contract_domain: EnterpriseContractDomainTable;
  enterprise_contract_employee_eligibility: EnterpriseContractEmployeeEligibilityTable;
  enterprise_contract_event_coverage: EnterpriseContractEventCoverageTable;
  enterprise_contract_event_registration: EnterpriseContractEventRegistrationTable;
  enterprise_contract_owner_assignment: EnterpriseContractOwnerAssignmentTable;
  email_delivery_capture: EmailDeliveryCaptureTable;
  email_design: EmailDesignTable;
  email_design_version: EmailDesignVersionTable;
  event_admin_assignment: EventAdminAssignmentTable;
  event_access_redemption: EventAccessRedemptionTable;
  event_attendance: EventAttendanceTable;
  event_coordinator_assignment: EventCoordinatorAssignmentTable;
  event_guest_access: EventGuestAccessTable;
  event_occurrence: EventOccurrenceTable;
  event_occurrence_communication_revision: EventOccurrenceCommunicationRevisionTable;
  event_communication_schedule: EventCommunicationScheduleTable;
  event_late_registration_invitation: EventLateRegistrationInvitationTable;
  event_operational_communication_schedule: EventOperationalCommunicationScheduleTable;
  event_occurrence_domain: EventOccurrenceDomainTable;
  event_occurrence_region: EventOccurrenceRegionTable;
  event_occurrence_reschedule: EventOccurrenceRescheduleTable;
  event_occurrence_reschedule_region: EventOccurrenceRescheduleRegionTable;
  event_occurrence_reschedule_region_coordinator: EventOccurrenceRescheduleRegionCoordinatorTable;
  event_participation: EventParticipationTable;
  event_prerequisite_email_capture: EventPrerequisiteEmailCaptureTable;
  event_prerequisite_sms_capture: EventPrerequisiteSmsCaptureTable;
  event_prerequisite_recovery_challenge: EventPrerequisiteRecoveryChallengeTable;
  event_prerequisite_task_session: EventPrerequisiteTaskSessionTable;
  event_presenter_assignment: EventPresenterAssignmentTable;
  event_staff_eligibility: EventStaffEligibilityTable;
  event_region_review_round: EventRegionReviewRoundTable;
  event_registration: EventRegistrationTable;
  event_registration_region_decision: EventRegistrationRegionDecisionTable;
  event_registration_transition: EventRegistrationTransitionTable;
  event_section_release: EventSectionReleaseTable;
  event_survey_access: EventSurveyAccessTable;
  event_session: EventSessionTable;
  event_template: EventTemplateTable;
  event_template_session_definition: EventTemplateSessionDefinitionTable;
  event_template_version: EventTemplateVersionTable;
  event_template_version_communication: EventTemplateVersionCommunicationTable;
  event_template_version_admin_default: EventTemplateVersionAdminDefaultTable;
  event_template_version_coordinator_default: EventTemplateVersionCoordinatorDefaultTable;
  event_template_version_presenter_default: EventTemplateVersionPresenterDefaultTable;
  event_template_version_region: EventTemplateVersionRegionTable;
  event_template_version_item: EventTemplateVersionItemTable;
  event_template_version_section: EventTemplateVersionSectionTable;
  event_virtual_room: EventVirtualRoomTable;
  event_virtual_room_operation: EventVirtualRoomOperationTable;
  event_virtual_join_access: EventVirtualJoinAccessTable;
  event_virtual_lobby_entry: EventVirtualLobbyEntryTable;
  event_virtual_recovery_challenge: EventVirtualRecoveryChallengeTable;
  event_virtual_join_session: EventVirtualJoinSessionTable;
  event_virtual_recovery_email_capture: EventVirtualRecoveryEmailCaptureTable;
  event_virtual_recovery_sms_capture: EventVirtualRecoverySmsCaptureTable;
  learning_item_progress: LearningItemProgressTable;
  learning_activity: LearningActivityTable;
  learning_activity_version: LearningActivityVersionTable;
  learning_progress_override: LearningProgressOverrideTable;
  learning_resource_version: LearningResourceVersionTable;
  notification: NotificationTable;
  notification_delivery_attempt: NotificationDeliveryAttemptTable;
  onboarding_assignment: OnboardingAssignmentTable;
  contact_verification_challenge: ContactVerificationChallengeTable;
  onboarding_definition: OnboardingDefinitionTable;
  onboarding_definition_version: OnboardingDefinitionVersionTable;
  contact_verification_email_capture: ContactVerificationEmailCaptureTable;
  onboarding_response: OnboardingResponseTable;
  contact_verification_sms_capture: ContactVerificationSmsCaptureTable;
  organization: OrganizationTable;
  organization_member: OrganizationMemberTable;
  platform_admin: PlatformAdminTable;
  platform_admin_invitation: PlatformAdminInvitationTable;
  phone_verification_claim: PhoneVerificationClaimTable;
  registration_questionnaire_assignment: RegistrationQuestionnaireAssignmentTable;
  registration_questionnaire_response: RegistrationQuestionnaireResponseTable;
  bulk_order: BulkOrderTable;
  order: OrderTable;
  order_item: OrderItemTable;
  order_refund: OrderRefundTable;
  outbox_event: OutboxEventTable;
  session: SessionTable;
  scorm_attempt: ScormAttemptTable;
  scorm_attempt_context: ScormAttemptContextTable;
  scorm_attempt_session: ScormAttemptSessionTable;
  scorm_launch_token: ScormLaunchTokenTable;
  scorm_package_version: ScormPackageVersionTable;
  sms_delivery: SmsDeliveryTable;
  sms_delivery_webhook_event: SmsDeliveryWebhookEventTable;
  survey_progress: SurveyProgressTable;
  survey_response: SurveyResponseTable;
  survey_version: SurveyVersionTable;
  user: UserTable;
  verification: VerificationTable;
}
