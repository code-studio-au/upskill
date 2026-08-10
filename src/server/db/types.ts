import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
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
  scormPackageVersionId: string | null;
  surveyVersionId: string | null;
  resourceVersionId: string | null;
  createdAt: Timestamp;
}

interface SurveyTable {
  id: string;
  title: string;
  createdAt: Timestamp;
}

interface SurveyVersionTable {
  id: string;
  surveyId: string;
  version: number;
  content: Json;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface LearningResourceTable {
  id: string;
  title: string;
  createdAt: Timestamp;
}

interface LearningResourceVersionTable {
  id: string;
  resourceId: string;
  version: number;
  displayName: string;
  description: string;
  objectKey: string;
  sha256: string;
  sourceBytes: number;
  mediaType: "application/pdf";
  createdAt: Timestamp;
}

interface ScormPackageTable {
  id: string;
  title: string;
  createdAt: Timestamp;
}

interface ScormPackageVersionTable {
  id: string;
  packageId: string;
  version: number;
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
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
}

interface CourseVersionModuleTable {
  courseVersionId: string;
  position: number;
  scormPackageVersionId: string;
  createdAt: Timestamp;
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
  accessCodeDigest: string | null;
  enrollmentDurationDays: number;
  quantity: number;
  redeemed: Generated<number>;
  expiresAt: Timestamp | null;
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
  | "course.archived"
  | "course.created"
  | "course.deleted"
  | "course.published"
  | "course.version_created"
  | "enrollment.access_code_redeemed"
  | "enrollment.learning_completed"
  | "enrollment.purchased"
  | "enrollment.scorm_completed"
  | "learning.progress_overridden"
  | "order.checkout_failed"
  | "order.checkout_paid"
  | "order.paid_existing_enrollment"
  | "resource.uploaded"
  | "scorm.attempt_launch_issued"
  | "scorm.package_ready"
  | "scorm.package_rejected"
  | "scorm.package_uploaded"
  | "scorm.package_version_removed";

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
  course_version_module: CourseVersionModuleTable;
  course_version_section: CourseVersionSectionTable;
  enrollment: EnrollmentTable;
  learning_item_progress: LearningItemProgressTable;
  learning_progress_override: LearningProgressOverrideTable;
  learning_resource: LearningResourceTable;
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
  scorm_package: ScormPackageTable;
  scorm_package_version: ScormPackageVersionTable;
  survey: SurveyTable;
  survey_version: SurveyVersionTable;
  user: UserTable;
  verification: VerificationTable;
}
