import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type Json = ColumnType<unknown, unknown, unknown>;

interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  stripeCustomerId: string | null;
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

interface PlatformAdminTable {
  userId: string;
  grantedByUserId: string | null;
  createdAt: Timestamp;
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
  createdAt: Timestamp;
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
  enrollmentId: string;
  courseVersionItemId: string;
  surveyVersionId: string;
  answers: Json;
  submittedAt: Timestamp;
}

interface SurveyProgressTable {
  enrollmentId: string;
  courseVersionItemId: string;
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
  enrollmentId: string;
  modulePosition: number;
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
  enrollmentId: string;
  courseVersionItemId: string;
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
  summary: string;
  description: string;
  hasCompletionCertificate: boolean;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface CoordinationRegionTable {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
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
  registrationMode:
    "open_entry" | "required_unrestricted" | "required_restricted";
  approvalMode: "automatic" | "manual";
  timezone: string;
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
  startsAt: Timestamp;
  endsAt: Timestamp;
  presenterRequired: boolean;
  venueName: string | null;
  venueAddress: string | null;
  virtualJoinUrl: string | null;
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
  previousStartsAt: Timestamp;
  previousEndsAt: Timestamp;
  previousRegistrationOpensAt: Timestamp | null;
  previousRegistrationClosesAt: Timestamp | null;
  previousCoordinatorLockAt: Timestamp | null;
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
  source: "ordinary" | "late_invitation" | "administrator_override";
  eligibilitySource:
    "unrestricted" | "verified_domain" | "administrator_override";
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
}

interface EventRegistrationTransitionTable {
  id: string;
  eventRegistrationId: string;
  fromStatus: EventRegistrationTable["status"] | null;
  toStatus: EventRegistrationTable["status"];
  source:
    "learner" | "automatic" | "coordinator" | "administrator" | "deadline";
  actorUserId: string | null;
  priority: number | null;
  occurredAt: Timestamp;
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
  createdAt: Timestamp;
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

interface OrderTable {
  id: string;
  purchaserUserId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  status: "pending" | "paid" | "failed" | "refunded";
  currency: string;
  totalCents: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface OrderItemTable {
  id: string;
  orderId: string;
  courseVersionId: string;
  quantity: number;
  unitPriceCents: number;
  enrollmentDurationDays: number;
  createdAt: Timestamp;
}

interface AccessGrantTable {
  id: string;
  organizationId: string | null;
  orderId: string | null;
  courseVersionId: string;
  accessCodeLookupId: Generated<string | null>;
  encryptedAccessCode: Generated<string | null>;
  label: Generated<string | null>;
  createdByUserId: Generated<string | null>;
  enrollmentDurationDays: number;
  quantity: number;
  redeemed: Generated<number>;
  expiresAt: Timestamp | null;
  revokedAt: OptionalTimestamp;
  revokedByUserId: Generated<string | null>;
  createdAt: Timestamp;
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

export type AuditEventAction =
  | "access_grant.administrator_capacity_updated"
  | "access_grant.administrator_code_revealed"
  | "access_grant.administrator_created"
  | "access_grant.administrator_revoked"
  | "course.archived"
  | "course.created"
  | "course.deleted"
  | "course.published"
  | "course.version_created"
  | "event_occurrence.created"
  | "event_occurrence.updated"
  | "event_occurrence.published"
  | "event_occurrence.lifecycle_changed"
  | "event_occurrence.rescheduled"
  | "event_attendance.recorded"
  | "event_region_review.locked"
  | "event_registration.administrator_added"
  | "event_registration.coordinator_reviewed"
  | "event_registration.final_decided"
  | "event_registration.submitted"
  | "event_registration.withdrawn"
  | "event_template.created"
  | "event_template.version_created"
  | "event_template.version_published"
  | "enrollment.access_code_redeemed"
  | "enrollment.administrator_added"
  | "enrollment.administrator_removed"
  | "enrollment.learning_completed"
  | "enrollment.purchased"
  | "enrollment.scorm_completed"
  | "learning.progress_overridden"
  | "order.checkout_failed"
  | "order.checkout_paid"
  | "order.paid_existing_enrollment"
  | "resource.uploaded"
  | "resource.version_removed"
  | "scorm.attempt_launch_issued"
  | "scorm.package_ready"
  | "scorm.package_rejected"
  | "scorm.package_uploaded"
  | "scorm.package_version_removed"
  | "survey.created"
  | "survey.published"
  | "survey.version_created";

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
  account: AccountTable;
  access_grant: AccessGrantTable;
  access_grant_domain: AccessGrantDomainTable;
  audit_event: AuditEventTable;
  course: CourseTable;
  course_version: CourseVersionTable;
  course_version_item: CourseVersionItemTable;
  course_version_section: CourseVersionSectionTable;
  coordination_region: CoordinationRegionTable;
  enrollment: EnrollmentTable;
  event_admin_assignment: EventAdminAssignmentTable;
  event_attendance: EventAttendanceTable;
  event_coordinator_assignment: EventCoordinatorAssignmentTable;
  event_occurrence: EventOccurrenceTable;
  event_occurrence_domain: EventOccurrenceDomainTable;
  event_occurrence_region: EventOccurrenceRegionTable;
  event_occurrence_reschedule: EventOccurrenceRescheduleTable;
  event_occurrence_reschedule_region: EventOccurrenceRescheduleRegionTable;
  event_occurrence_reschedule_region_coordinator: EventOccurrenceRescheduleRegionCoordinatorTable;
  event_participation: EventParticipationTable;
  event_presenter_assignment: EventPresenterAssignmentTable;
  event_region_review_round: EventRegionReviewRoundTable;
  event_registration: EventRegistrationTable;
  event_registration_transition: EventRegistrationTransitionTable;
  event_session: EventSessionTable;
  event_template: EventTemplateTable;
  event_template_session_definition: EventTemplateSessionDefinitionTable;
  event_template_version: EventTemplateVersionTable;
  event_template_version_admin_default: EventTemplateVersionAdminDefaultTable;
  event_template_version_coordinator_default: EventTemplateVersionCoordinatorDefaultTable;
  event_template_version_presenter_default: EventTemplateVersionPresenterDefaultTable;
  event_template_version_region: EventTemplateVersionRegionTable;
  event_template_version_item: EventTemplateVersionItemTable;
  event_template_version_section: EventTemplateVersionSectionTable;
  learning_item_progress: LearningItemProgressTable;
  learning_activity: LearningActivityTable;
  learning_activity_version: LearningActivityVersionTable;
  learning_progress_override: LearningProgressOverrideTable;
  learning_resource_version: LearningResourceVersionTable;
  organization: OrganizationTable;
  organization_member: OrganizationMemberTable;
  platform_admin: PlatformAdminTable;
  order: OrderTable;
  order_item: OrderItemTable;
  outbox_event: OutboxEventTable;
  session: SessionTable;
  scorm_attempt: ScormAttemptTable;
  scorm_attempt_session: ScormAttemptSessionTable;
  scorm_launch_token: ScormLaunchTokenTable;
  scorm_package_version: ScormPackageVersionTable;
  survey_progress: SurveyProgressTable;
  survey_response: SurveyResponseTable;
  survey_version: SurveyVersionTable;
  user: UserTable;
  verification: VerificationTable;
}
