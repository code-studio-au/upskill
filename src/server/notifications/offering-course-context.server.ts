import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { findEffectiveModuleCompletion } from "#/server/learning/progress-overrides.server";
import { getEmailTemplateContract } from "./email-template-contracts";

export interface CourseNotificationRecipient {
  userId: string;
  name: string;
  email: string;
  enrollmentId: string;
}

function dateLabel(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-AU", { dateStyle: "long" }).format(value)
    : "";
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name;
}

function emptyCourseVariables(): Record<string, string> {
  return Object.fromEntries(
    getEmailTemplateContract("offering.course").variables.map((variable) => [
      variable.key,
      "",
    ]),
  );
}

export async function buildCourseNotificationVariables(
  database: Kysely<Database>,
  input: {
    courseVersionId: string;
    sectionId: string | null;
    recipient: CourseNotificationRecipient;
  },
): Promise<Record<string, string>> {
  const row = await database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version as version",
      "version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "version.courseId")
    .innerJoin("user", "user.id", "enrollment.userId")
    .leftJoin(
      "coordination_region as region",
      "region.id",
      "user.currentRegionId",
    )
    .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
    .select([
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "course.slug",
      "course.title",
      "version.version",
      "version.content",
      "user.phone",
      "region.name as regionName",
      "region.code as regionCode",
      "parent.name as regionGroupName",
      "parent.code as regionGroupCode",
    ])
    .where("enrollment.id", "=", input.recipient.enrollmentId)
    .where("version.id", "=", input.courseVersionId)
    .executeTakeFirstOrThrow();
  const content = courseContentSchema.parse(row.content);
  const [items, completedItems, completedModules, section, entitlement] =
    await Promise.all([
      database
        .selectFrom("course_version_item")
        .select(["id", "kind", "modulePosition"])
        .where("courseVersionId", "=", input.courseVersionId)
        .execute(),
      database
        .selectFrom("learning_item_progress")
        .select("courseVersionItemId")
        .where("enrollmentId", "=", input.recipient.enrollmentId)
        .where("state", "=", "completed")
        .execute(),
      findEffectiveModuleCompletion(
        database,
        input.recipient.enrollmentId,
        input.courseVersionId,
      ),
      input.sectionId
        ? database
            .selectFrom("course_version_section")
            .select("title")
            .where("id", "=", input.sectionId)
            .where("courseVersionId", "=", input.courseVersionId)
            .executeTakeFirst()
        : undefined,
      database
        .selectFrom("entitlement")
        .leftJoin("order", "order.id", "entitlement.originOrderId")
        .leftJoin("order_item", (join) =>
          join
            .onRef("order_item.orderId", "=", "order.id")
            .onRef(
              "order_item.courseVersionId",
              "=",
              "entitlement.courseVersionId",
            ),
        )
        .select([
          "order.id as orderId",
          "order.createdAt as orderedAt",
          "order.currency",
          "order.totalCents",
          "order_item.quantity",
          "order_item.unitPriceCents",
        ])
        .where("entitlement.enrollmentId", "=", input.recipient.enrollmentId)
        .executeTakeFirst(),
    ]);
  const completedItemIds = new Set(
    completedItems.flatMap((item) =>
      item.courseVersionItemId ? [item.courseVersionItemId] : [],
    ),
  );
  const completedModulePositions = new Set(
    completedModules
      .filter((module) => module.state === "completed")
      .map((module) => module.position),
  );
  const completedCount = items.filter((item) =>
    item.kind === "scorm"
      ? item.modulePosition !== null &&
        completedModulePositions.has(item.modulePosition)
      : completedItemIds.has(item.id),
  ).length;
  const environment = getServerEnv();
  const baseUrl = new URL(environment.APP_ORIGIN).origin;
  const variables = emptyCourseVariables();
  variables["user.fullName"] = input.recipient.name;
  variables["user.firstName"] = firstName(input.recipient.name);
  variables["user.email"] = input.recipient.email;
  variables["user.phoneNumber"] = row.phone ?? "";
  variables["user.operationalRegionName"] = row.regionName ?? "";
  variables["user.operationalRegionCode"] = row.regionCode ?? "";
  variables["user.regionGroupName"] = row.regionGroupName ?? "";
  variables["user.regionGroupCode"] = row.regionGroupCode ?? "";
  variables["user.profileUrl"] = `${baseUrl}/profile`;
  variables["platform.name"] = "Upskill";
  variables["platform.homeUrl"] = baseUrl;
  variables["platform.learningUrl"] = `${baseUrl}/my-learning`;
  variables["platform.eventsUrl"] = `${baseUrl}/my-events`;
  variables["platform.supportEmail"] = environment.SUPPORT_EMAIL;
  variables["course.title"] = row.title;
  variables["course.summary"] = content.summary;
  variables["course.description"] = content.description;
  variables["course.topic"] = content.topic;
  variables["course.version"] = String(row.version);
  variables["course.duration"] = `${String(content.durationMinutes)} minutes`;
  variables["course.standardPrice"] = money(
    content.priceCents,
    content.currency,
  );
  variables["course.currentPrice"] = money(
    content.salePriceCents ?? content.priceCents,
    content.currency,
  );
  variables["course.currency"] = content.currency;
  variables["course.sectionCount"] = String(content.sections?.length ?? 0);
  variables["course.activityCount"] = String(items.length);
  variables["course.prerequisites"] = content.prerequisites.join(", ");
  variables["course.accreditations"] = content.accreditations
    .map((accreditation) => accreditation.name)
    .join(", ");
  variables["course.cpdPoints"] = String(
    content.accreditations.reduce(
      (total, accreditation) => total + (accreditation.cpdPoints ?? 0),
      0,
    ),
  );
  variables["course.certificateAvailable"] = content.hasCompletionCertificate
    ? "Available after completion"
    : "Not available";
  variables["course.catalogueUrl"] = `${baseUrl}/courses/${row.slug}`;
  variables["course.dashboardUrl"] = `${baseUrl}/my-learning`;
  variables["course.certificateUrl"] = content.hasCompletionCertificate
    ? `${baseUrl}/api/learning/certificates/${input.recipient.enrollmentId}`
    : "";
  variables["enrolment.status"] =
    row.status === "active" ? "In progress" : row.status;
  variables["enrolment.enrolledAt"] = dateLabel(row.enrolledAt);
  variables["enrolment.expiresAt"] = dateLabel(row.expiresAt);
  variables["enrolment.completedAt"] = dateLabel(row.completedAt);
  variables["enrolment.progressPercent"] = items.length
    ? `${String(Math.round((completedCount / items.length) * 100))}%`
    : "0%";
  variables["enrolment.completedItemCount"] = String(completedCount);
  variables["enrolment.totalItemCount"] = String(items.length);
  variables["enrolment.remainingItemCount"] = String(
    Math.max(0, items.length - completedCount),
  );
  variables["section.title"] = section?.title ?? "";
  if (entitlement?.orderId) {
    variables["order.reference"] = entitlement.orderId;
    variables["order.purchasedAt"] = dateLabel(entitlement.orderedAt ?? null);
    variables["order.quantity"] = String(entitlement.quantity ?? 1);
    variables["order.unitPrice"] = money(
      entitlement.unitPriceCents ?? 0,
      entitlement.currency ?? content.currency,
    );
    variables["order.total"] = money(
      entitlement.totalCents ?? 0,
      entitlement.currency ?? content.currency,
    );
    variables["order.currency"] = entitlement.currency ?? content.currency;
  }
  return variables;
}
