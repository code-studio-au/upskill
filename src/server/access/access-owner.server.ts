import "@tanstack/react-start/server-only";

import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type {
  AccessOwnerCodeExport,
  AccessOwnerDashboard,
} from "#/features/access-owner/access-owner.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import {
  findEffectiveModuleCompletionForEnrollments,
  type EffectiveModuleCompletion,
} from "#/server/learning/progress-overrides.server";
import { decryptAccessCode } from "./access-code-encryption.server";

export async function hasAccessOwnerAssignments(
  userId: string,
): Promise<boolean> {
  return Boolean(
    await getDatabase()
      .selectFrom("access_grant_owner_assignment")
      .select("id")
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .executeTakeFirst(),
  );
}

async function activateEligibleAssignments(
  user: AuthenticatedUser,
): Promise<void> {
  if (!user.emailVerified) return;
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const assignments = await transaction
        .selectFrom("access_grant_owner_assignment")
        .select(["id", "accessGrantId"])
        .where("userId", "=", user.id)
        .where("invitedEmail", "=", user.email.toLocaleLowerCase("en-AU"))
        .where("activatedAt", "is", null)
        .where("revokedAt", "is", null)
        .forUpdate()
        .execute();
      const now = new Date();
      for (const assignment of assignments) {
        await transaction
          .updateTable("access_grant_owner_assignment")
          .set({ activatedAt: now })
          .where("id", "=", assignment.id)
          .where("activatedAt", "is", null)
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "access_grant.owner_activated",
          subjectType: "access_grant_owner_assignment",
          subjectId: assignment.id,
          aggregateId: assignment.accessGrantId,
          metadata: { accessGrantId: assignment.accessGrantId },
          createdAt: now,
        });
      }
    });
}

type ProgressItem = {
  id: string;
  kind: "scorm" | "survey" | "resource";
  required: boolean;
  modulePosition: number | null;
};

function enrollmentProgressPercent(
  input: {
    enrollmentId: string;
    courseVersionId: string;
    status: "active" | "completed" | "expired" | "cancelled";
    content: unknown;
  },
  items: ReadonlyArray<ProgressItem>,
  completedIds: ReadonlySet<string>,
  moduleCompletion: ReadonlyArray<EffectiveModuleCompletion>,
): number {
  if (input.status === "completed") return 100;
  const completedModules = new Set<number>();
  for (const module of moduleCompletion)
    if (module.state === "completed") completedModules.add(module.position);
  if (items.length > 0) {
    const required = items.filter((item) => item.required);
    const targets = required.length > 0 ? required : items;
    let completed = 0;
    for (const item of targets)
      if (
        completedIds.has(item.id) ||
        (item.kind === "scorm" &&
          item.modulePosition !== null &&
          completedModules.has(item.modulePosition))
      )
        completed += 1;
    return Math.round((completed / targets.length) * 100);
  }
  const legacyModules = courseContentSchema.parse(input.content).modules;
  if (legacyModules.length === 0) return 0;
  return Math.round((completedModules.size / legacyModules.length) * 100);
}

function grantState(grant: {
  redeemed: number;
  quantity: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): "active" | "exhausted" | "expired" | "revoked" {
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt && grant.expiresAt <= new Date()) return "expired";
  return grant.redeemed >= grant.quantity ? "exhausted" : "active";
}

export async function findAccessOwnerDashboard(
  user: AuthenticatedUser,
): Promise<AccessOwnerDashboard | null> {
  await activateEligibleAssignments(user);
  const database = getDatabase();
  const grants = await database
    .selectFrom("access_grant_owner_assignment as assignment")
    .innerJoin("access_grant", "access_grant.id", "assignment.accessGrantId")
    .innerJoin("organization", "organization.id", "access_grant.organizationId")
    .innerJoin(
      "course_version",
      "course_version.id",
      "access_grant.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "access_grant.id",
      "access_grant.label",
      "access_grant.kind",
      "access_grant.quantity",
      "access_grant.redeemed",
      "access_grant.customerExtendable",
      "access_grant.fulfillmentMode",
      "access_grant.expiresAt",
      "access_grant.revokedAt",
      "organization.name as organizationName",
      "course.title as courseTitle",
    ])
    .where("assignment.userId", "=", user.id)
    .where("assignment.activatedAt", "is not", null)
    .where("assignment.revokedAt", "is", null)
    .orderBy("organization.name")
    .orderBy("course.title")
    .execute();
  if (grants.length === 0) return null;
  const grantIds = grants.map((grant) => grant.id);
  const learners = await database
    .selectFrom("entitlement")
    .innerJoin("enrollment", "enrollment.id", "entitlement.enrollmentId")
    .innerJoin("user", "user.id", "entitlement.userId")
    .leftJoin(
      "access_grant_code",
      "access_grant_code.id",
      "entitlement.originAccessGrantCodeId",
    )
    .innerJoin(
      "course_version",
      "course_version.id",
      "entitlement.courseVersionId",
    )
    .select([
      "entitlement.originAccessGrantId as accessGrantId",
      "entitlement.redemptionEmailSnapshot as email",
      "entitlement.grantedAt",
      "enrollment.id as enrollmentId",
      "enrollment.status",
      "user.name",
      "course_version.id as courseVersionId",
      "course_version.content",
      "access_grant_code.ordinal as codeNumber",
    ])
    .where("entitlement.originAccessGrantId", "in", grantIds)
    .where("entitlement.informationReleaseAcceptedAt", "is not", null)
    .where("entitlement.revokedAt", "is", null)
    .orderBy("entitlement.grantedAt", "desc")
    .execute();
  const enrollmentReferences = learners.map((learner) => ({
    enrollmentId: learner.enrollmentId,
    courseVersionId: learner.courseVersionId,
  }));
  const enrollmentIds = enrollmentReferences.map(
    (reference) => reference.enrollmentId,
  );
  const courseVersionIds = [
    ...new Set(
      enrollmentReferences.map((reference) => reference.courseVersionId),
    ),
  ];
  const [itemRows, completedRows, moduleCompletionByEnrollment] =
    enrollmentReferences.length === 0
      ? [[], [], new Map<string, Array<EffectiveModuleCompletion>>()]
      : await Promise.all([
          database
            .selectFrom("course_version_item")
            .select([
              "courseVersionId",
              "id",
              "kind",
              "required",
              "modulePosition",
            ])
            .where("courseVersionId", "in", courseVersionIds)
            .execute(),
          database
            .selectFrom("learning_item_progress")
            .select(["enrollmentId", "courseVersionItemId"])
            .where("enrollmentId", "in", enrollmentIds)
            .where("state", "=", "completed")
            .execute(),
          findEffectiveModuleCompletionForEnrollments(
            database,
            enrollmentReferences,
          ),
        ]);
  const itemsByVersion = new Map<string, Array<ProgressItem>>();
  for (const item of itemRows) {
    const versionItems = itemsByVersion.get(item.courseVersionId) ?? [];
    versionItems.push(item);
    itemsByVersion.set(item.courseVersionId, versionItems);
  }
  const completedIdsByEnrollment = new Map<string, Set<string>>();
  for (const row of completedRows) {
    if (row.enrollmentId === null || row.courseVersionItemId === null) continue;
    const completedIds =
      completedIdsByEnrollment.get(row.enrollmentId) ?? new Set();
    completedIds.add(row.courseVersionItemId);
    completedIdsByEnrollment.set(row.enrollmentId, completedIds);
  }
  const learnerGroups = new Map<
    string,
    AccessOwnerDashboard["grants"][number]["learners"]
  >();
  for (const learner of learners) {
    if (!learner.accessGrantId) continue;
    const progressPercent = enrollmentProgressPercent(
      {
        enrollmentId: learner.enrollmentId,
        courseVersionId: learner.courseVersionId,
        status: learner.status,
        content: learner.content,
      },
      itemsByVersion.get(learner.courseVersionId) ?? [],
      completedIdsByEnrollment.get(learner.enrollmentId) ?? new Set(),
      moduleCompletionByEnrollment.get(learner.enrollmentId) ?? [],
    );
    learnerGroups.set(learner.accessGrantId, [
      ...(learnerGroups.get(learner.accessGrantId) ?? []),
      {
        enrollmentId: learner.enrollmentId,
        name: learner.name,
        email: learner.email,
        enrolledAt: learner.grantedAt.toISOString(),
        progressPercent,
        completionState:
          learner.status === "completed" ? "complete" : "incomplete",
        codeNumber: learner.codeNumber,
      },
    ]);
  }
  return {
    grants: grants.map((grant) => ({
      id: grant.id,
      label: grant.label ?? "Organisation access",
      organizationName: grant.organizationName,
      courseTitle: grant.courseTitle,
      kind:
        grant.kind === "enterprise_contract"
          ? "enterprise_contract"
          : "bulk_purchase",
      quantity: grant.quantity,
      redeemed: grant.redeemed,
      remaining: Math.max(0, grant.quantity - grant.redeemed),
      customerExtendable: grant.customerExtendable,
      fulfillmentMode: grant.fulfillmentMode ?? "shared_code",
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      state: grantState(grant),
      learners: learnerGroups.get(grant.id) ?? [],
    })),
  };
}

async function findActiveOwnerAssignment(
  accessGrantId: string,
  userId: string,
) {
  return await getDatabase()
    .selectFrom("access_grant_owner_assignment")
    .select("id")
    .where("accessGrantId", "=", accessGrantId)
    .where("userId", "=", userId)
    .where("activatedAt", "is not", null)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
}

export async function revealAccessOwnerCode(
  accessGrantId: string,
  user: AuthenticatedUser,
): Promise<{ status: "ready"; accessCode: string } | { status: "not-found" }> {
  if (!(await findActiveOwnerAssignment(accessGrantId, user.id)))
    return { status: "not-found" };
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const grant = await transaction
        .selectFrom("access_grant")
        .innerJoin(
          "access_grant_code",
          "access_grant_code.accessGrantId",
          "access_grant.id",
        )
        .select([
          "access_grant.id",
          "access_grant_code.lookupId",
          "access_grant_code.encryptedAccessCode",
        ])
        .where("access_grant.id", "=", accessGrantId)
        .where("access_grant_code.ordinal", "is", null)
        .executeTakeFirst();
      if (!grant) return { status: "not-found" } as const;
      const accessCode = decryptAccessCode({
        accessGrantId: grant.id,
        lookupId: grant.lookupId,
        encryptedAccessCode: grant.encryptedAccessCode,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "access_grant.owner_code_revealed",
        subjectType: "access_grant",
        subjectId: grant.id,
        aggregateId: grant.id,
      });
      return { status: "ready", accessCode } as const;
    });
}

export async function exportAccessOwnerCodes(
  accessGrantId: string,
  user: AuthenticatedUser,
): Promise<
  { status: "ready"; data: AccessOwnerCodeExport } | { status: "not-found" }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const assignment = await transaction
        .selectFrom("access_grant_owner_assignment")
        .select("id")
        .where("accessGrantId", "=", accessGrantId)
        .where("userId", "=", user.id)
        .where("activatedAt", "is not", null)
        .where("revokedAt", "is", null)
        .executeTakeFirst();
      if (!assignment) return { status: "not-found" } as const;
      const grant = await transaction
        .selectFrom("access_grant")
        .innerJoin(
          "organization",
          "organization.id",
          "access_grant.organizationId",
        )
        .innerJoin(
          "course_version",
          "course_version.id",
          "access_grant.courseVersionId",
        )
        .innerJoin("course", "course.id", "course_version.courseId")
        .select([
          "access_grant.id",
          "organization.name as organizationName",
          "course.title as courseTitle",
        ])
        .where("access_grant.id", "=", accessGrantId)
        .executeTakeFirst();
      if (!grant) return { status: "not-found" } as const;
      const codes = await transaction
        .selectFrom("access_grant_code")
        .leftJoin(
          "entitlement",
          "entitlement.originAccessGrantCodeId",
          "access_grant_code.id",
        )
        .leftJoin("user", "user.id", "entitlement.userId")
        .select([
          "access_grant_code.lookupId",
          "access_grant_code.encryptedAccessCode",
          "access_grant_code.ordinal as codeNumber",
          "entitlement.id as entitlementId",
          "entitlement.grantedAt as redeemedAt",
          "entitlement.redemptionEmailSnapshot as redemptionEmail",
          "user.name as learnerName",
        ])
        .where("access_grant_code.accessGrantId", "=", accessGrantId)
        .orderBy("access_grant_code.ordinal", "asc")
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "access_grant.owner_code_revealed",
        subjectType: "access_grant",
        subjectId: grant.id,
        aggregateId: grant.id,
        metadata: { format: "csv", codeCount: codes.length },
      });
      return {
        status: "ready",
        data: {
          accessGrantId: grant.id,
          organizationName: grant.organizationName,
          courseTitle: grant.courseTitle,
          codes: codes.map((code) => ({
            codeNumber: code.codeNumber,
            accessCode: decryptAccessCode({
              accessGrantId: grant.id,
              lookupId: code.lookupId,
              encryptedAccessCode: code.encryptedAccessCode,
            }),
            status: code.entitlementId ? "redeemed" : "available",
            redeemedAt: code.redeemedAt?.toISOString() ?? null,
            learnerName: code.learnerName,
            redemptionEmail: code.redemptionEmail,
          })),
        },
      } as const;
    });
}
