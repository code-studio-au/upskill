import "@tanstack/react-start/server-only";

import { sql } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import { bulkPricingSchema } from "#/features/catalog/catalog.schema";
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
  const database = getDatabase();
  const [grant, contract] = await Promise.all([
    database
      .selectFrom("access_grant_owner_assignment")
      .select("id")
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .executeTakeFirst(),
    database
      .selectFrom("enterprise_contract_owner_assignment")
      .select("id")
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .executeTakeFirst(),
  ]);
  return Boolean(grant || contract);
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
      const contractAssignments = await transaction
        .selectFrom("enterprise_contract_owner_assignment")
        .select(["id", "enterpriseContractId"])
        .where("userId", "=", user.id)
        .where("invitedEmail", "=", user.email.toLocaleLowerCase("en-AU"))
        .where("activatedAt", "is", null)
        .where("revokedAt", "is", null)
        .forUpdate()
        .execute();
      for (const assignment of contractAssignments) {
        await transaction
          .updateTable("enterprise_contract_owner_assignment")
          .set({ activatedAt: now })
          .where("id", "=", assignment.id)
          .where("activatedAt", "is", null)
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "enterprise_contract.owner_activated",
          subjectType: "enterprise_contract_owner_assignment",
          subjectId: assignment.id,
          aggregateId: assignment.enterpriseContractId,
          metadata: {},
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
    .leftJoin(
      "course_version",
      "course_version.id",
      "access_grant.courseVersionId",
    )
    .leftJoin("course", "course.id", "course_version.courseId")
    .leftJoin(
      "event_occurrence",
      "event_occurrence.id",
      "access_grant.eventOccurrenceId",
    )
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
      "course_version.content",
      "event_occurrence.title as eventTitle",
      "event_occurrence.bulkPricing as eventBulkPricing",
    ])
    .where("assignment.userId", "=", user.id)
    .where("assignment.activatedAt", "is not", null)
    .where("assignment.revokedAt", "is", null)
    .orderBy("organization.name")
    .orderBy("access_grant.createdAt")
    .execute();
  const contractRows = await database
    .selectFrom("enterprise_contract_owner_assignment as assignment")
    .innerJoin(
      "enterprise_contract as contract",
      "contract.id",
      "assignment.enterpriseContractId",
    )
    .innerJoin("organization", "organization.id", "contract.organizationId")
    .select([
      "contract.id",
      "contract.name",
      "contract.reference",
      "contract.status",
      "contract.startsAt",
      "contract.expiresAt",
      "organization.name as organizationName",
    ])
    .where("assignment.userId", "=", user.id)
    .where("assignment.activatedAt", "is not", null)
    .where("assignment.revokedAt", "is", null)
    .orderBy("organization.name")
    .orderBy("contract.createdAt")
    .execute();
  if (grants.length === 0 && contractRows.length === 0) return null;
  const grantIds = grants.map((grant) => grant.id);
  const [learners, eventLearners, orders] = await Promise.all([
    database
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
      .execute(),
    database
      .selectFrom("event_access_redemption as redemption")
      .innerJoin(
        "event_participation as participation",
        "participation.id",
        "redemption.eventParticipationId",
      )
      .innerJoin("user", "user.id", "redemption.userId")
      .leftJoin(
        "access_grant_code",
        "access_grant_code.id",
        "redemption.accessGrantCodeId",
      )
      .select([
        "redemption.accessGrantId",
        "redemption.eventRegistrationId",
        "redemption.redemptionEmailSnapshot as email",
        "redemption.redeemedAt",
        "participation.completedAt",
        "user.name",
        "access_grant_code.ordinal as codeNumber",
      ])
      .where("redemption.accessGrantId", "in", grantIds)
      .orderBy("redemption.redeemedAt", "desc")
      .execute(),
    database
      .selectFrom("bulk_order")
      .innerJoin("order", "order.id", "bulk_order.orderId")
      .innerJoin("order_item", "order_item.orderId", "order.id")
      .select([
        "bulk_order.accessGrantId",
        "order.id",
        "order.kind",
        "order.status",
        "order.currency",
        "order.totalCents",
        "order.refundedCents",
        "order.stripeInvoiceId",
        "order.createdAt",
        "order_item.quantity",
        "order_item.unitPriceCents",
      ])
      .where("bulk_order.accessGrantId", "in", grantIds)
      .orderBy("order.createdAt", "desc")
      .execute(),
  ]);
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
  const orderGroups = new Map<
    string,
    AccessOwnerDashboard["grants"][number]["orders"]
  >();
  for (const order of orders) {
    if (
      !order.accessGrantId ||
      order.kind === "individual_purchase" ||
      order.kind === "event_registration"
    )
      continue;
    orderGroups.set(order.accessGrantId, [
      ...(orderGroups.get(order.accessGrantId) ?? []),
      {
        id: order.id,
        kind: order.kind,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        totalCents: order.totalCents,
        refundedCents: order.refundedCents,
        currency: order.currency,
        status: order.status,
        hasInvoice: Boolean(order.stripeInvoiceId),
        createdAt: order.createdAt.toISOString(),
      },
    ]);
  }
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
  for (const learner of eventLearners) {
    learnerGroups.set(learner.accessGrantId, [
      ...(learnerGroups.get(learner.accessGrantId) ?? []),
      {
        enrollmentId: learner.eventRegistrationId,
        name: learner.name,
        email: learner.email,
        enrolledAt: learner.redeemedAt.toISOString(),
        progressPercent: learner.completedAt ? 100 : 0,
        completionState: learner.completedAt ? "complete" : "incomplete",
        codeNumber: learner.codeNumber,
      },
    ]);
  }
  const contractIds = contractRows.map((contract) => contract.id);
  const [contractLearners, employeeCounts] =
    contractIds.length === 0
      ? [[], []]
      : await Promise.all([
          database
            .selectFrom("enterprise_contract_claim as claim")
            .innerJoin("user", "user.id", "claim.userId")
            .select([
              "claim.enterpriseContractId",
              "claim.emailSnapshot as email",
              "claim.claimedAt",
              "user.name",
              sql<number>`(select count(*)::integer from entitlement where entitlement."originEnterpriseContractClaimId" = claim.id and entitlement."revokedAt" is null)`.as(
                "courseEnrollmentCount",
              ),
              sql<number>`(select count(*)::integer from enterprise_contract_event_registration registration where registration."enterpriseContractClaimId" = claim.id)`.as(
                "eventRegistrationCount",
              ),
            ])
            .where("claim.enterpriseContractId", "in", contractIds)
            .where("claim.revokedAt", "is", null)
            .where("claim.informationReleaseAcceptedAt", "is not", null)
            .orderBy("claim.claimedAt", "desc")
            .execute(),
          database
            .selectFrom("enterprise_contract_employee_eligibility")
            .select([
              "enterpriseContractId",
              sql<number>`count(*)::integer`.as("count"),
            ])
            .where("enterpriseContractId", "in", contractIds)
            .where("removedAt", "is", null)
            .groupBy("enterpriseContractId")
            .execute(),
        ]);
  const learnersByContract = new Map<
    string,
    AccessOwnerDashboard["contracts"][number]["learners"]
  >();
  for (const learner of contractLearners) {
    const entries = learnersByContract.get(learner.enterpriseContractId) ?? [];
    entries.push({
      name: learner.name,
      email: learner.email,
      claimedAt: learner.claimedAt.toISOString(),
      courseEnrollmentCount: learner.courseEnrollmentCount,
      eventRegistrationCount: learner.eventRegistrationCount,
    });
    learnersByContract.set(learner.enterpriseContractId, entries);
  }
  const countByContract = new Map(
    employeeCounts.map((row) => [row.enterpriseContractId, row.count]),
  );
  const now = new Date();
  return {
    contracts: contractRows.map((contract) => ({
      id: contract.id,
      name: contract.name,
      reference: contract.reference,
      organizationName: contract.organizationName,
      status:
        contract.status === "terminated"
          ? "terminated"
          : contract.expiresAt <= now
            ? "expired"
            : contract.status,
      startsAt: contract.startsAt.toISOString(),
      expiresAt: contract.expiresAt.toISOString(),
      eligibleEmployeeCount: countByContract.get(contract.id) ?? 0,
      learners: learnersByContract.get(contract.id) ?? [],
    })),
    grants: grants.map((grant) => {
      const state = grantState(grant);
      const offeringType = grant.eventTitle
        ? ("event" as const)
        : ("course" as const);
      const pricing =
        offeringType === "event"
          ? bulkPricingSchema.parse(grant.eventBulkPricing)
          : courseContentSchema.parse(grant.content).bulkPricing;
      return {
        id: grant.id,
        label: grant.label ?? "Organisation access",
        organizationName: grant.organizationName,
        offeringType,
        offeringTitle:
          grant.eventTitle ?? grant.courseTitle ?? "Unavailable offering",
        kind:
          grant.kind === "enterprise_contract"
            ? "enterprise_contract"
            : "bulk_purchase",
        quantity: grant.quantity,
        redeemed: grant.redeemed,
        remaining: Math.max(0, grant.quantity - grant.redeemed),
        customerExtendable: grant.customerExtendable,
        canReorder:
          grant.kind === "bulk_purchase" &&
          grant.customerExtendable &&
          state !== "expired" &&
          state !== "revoked" &&
          pricing.enabled,
        pricingTiers: pricing.tiers,
        fulfillmentMode: grant.fulfillmentMode ?? "shared_code",
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        state,
        learners: learnerGroups.get(grant.id) ?? [],
        orders: orderGroups.get(grant.id) ?? [],
      };
    }),
  };
}

export async function recordEnterpriseContractReportExport(
  enterpriseContractId: string,
  user: AuthenticatedUser,
): Promise<boolean> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const assignment = await transaction
        .selectFrom("enterprise_contract_owner_assignment")
        .select("id")
        .where("enterpriseContractId", "=", enterpriseContractId)
        .where("userId", "=", user.id)
        .where("activatedAt", "is not", null)
        .where("revokedAt", "is", null)
        .executeTakeFirst();
      if (!assignment) return false;
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "enterprise_contract.report_exported",
        subjectType: "enterprise_contract",
        subjectId: enterpriseContractId,
        metadata: { format: "csv" },
      });
      return true;
    });
}

export async function findAccessOwnerInvoiceUrl(
  orderId: string,
  user: AuthenticatedUser,
): Promise<{ status: "ready"; url: string } | { status: "not-found" }> {
  const order = await getDatabase()
    .selectFrom("bulk_order")
    .innerJoin("order", "order.id", "bulk_order.orderId")
    .innerJoin(
      "access_grant_owner_assignment as assignment",
      "assignment.accessGrantId",
      "bulk_order.accessGrantId",
    )
    .select("order.stripeInvoiceId")
    .where("order.id", "=", orderId)
    .where("assignment.userId", "=", user.id)
    .where("assignment.activatedAt", "is not", null)
    .where("assignment.revokedAt", "is", null)
    .executeTakeFirst();
  if (!order?.stripeInvoiceId) return { status: "not-found" };
  const { stripeClient } = await import("#/server/stripe/stripe-client.server");
  const invoice = await stripeClient.invoices.retrieve(order.stripeInvoiceId);
  if (!invoice.hosted_invoice_url) return { status: "not-found" };
  const url = new URL(invoice.hosted_invoice_url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".stripe.com"))
    throw new Error("Stripe returned an unexpected invoice URL");
  return { status: "ready", url: url.toString() };
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
        .leftJoin(
          "course_version",
          "course_version.id",
          "access_grant.courseVersionId",
        )
        .leftJoin("course", "course.id", "course_version.courseId")
        .leftJoin(
          "event_occurrence",
          "event_occurrence.id",
          "access_grant.eventOccurrenceId",
        )
        .select([
          "access_grant.id",
          "organization.name as organizationName",
          "course.title as courseTitle",
          "event_occurrence.title as eventTitle",
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
        .leftJoin(
          "event_access_redemption as eventRedemption",
          "eventRedemption.accessGrantCodeId",
          "access_grant_code.id",
        )
        .leftJoin("user as eventUser", "eventUser.id", "eventRedemption.userId")
        .select([
          "access_grant_code.lookupId",
          "access_grant_code.encryptedAccessCode",
          "access_grant_code.ordinal as codeNumber",
          "entitlement.id as entitlementId",
          "entitlement.grantedAt as redeemedAt",
          "entitlement.redemptionEmailSnapshot as redemptionEmail",
          "user.name as learnerName",
          "eventRedemption.id as eventRedemptionId",
          "eventRedemption.redeemedAt as eventRedeemedAt",
          "eventRedemption.redemptionEmailSnapshot as eventRedemptionEmail",
          "eventUser.name as eventLearnerName",
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
          offeringTitle:
            grant.eventTitle ?? grant.courseTitle ?? "Unavailable offering",
          codes: codes.map((code) => ({
            codeNumber: code.codeNumber,
            accessCode: decryptAccessCode({
              accessGrantId: grant.id,
              lookupId: code.lookupId,
              encryptedAccessCode: code.encryptedAccessCode,
            }),
            status:
              code.entitlementId || code.eventRedemptionId
                ? "redeemed"
                : "available",
            redeemedAt:
              code.redeemedAt?.toISOString() ??
              code.eventRedeemedAt?.toISOString() ??
              null,
            learnerName: code.learnerName ?? code.eventLearnerName,
            redemptionEmail: code.redemptionEmail ?? code.eventRedemptionEmail,
          })),
        },
      } as const;
    });
}
