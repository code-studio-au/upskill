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

interface AuditEventTable {
  id: string;
  actorUserId: string | null;
  action: string;
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
  enrollment: EnrollmentTable;
  organization: OrganizationTable;
  organization_member: OrganizationMemberTable;
  order: OrderTable;
  outbox_event: OutboxEventTable;
  session: SessionTable;
  user: UserTable;
  verification: VerificationTable;
}
