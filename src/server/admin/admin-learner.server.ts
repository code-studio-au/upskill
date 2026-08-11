import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type {
  AdminEnrollmentDetail,
  AdminLearnerDirectory,
  AdminLearnerProfile,
  AdminLearnerSearch,
  AdminOverview,
  AdminProgressOverrideInput,
} from "#/features/admin/admin.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { enqueueAuditLogProjection } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { isLearningComplete } from "#/server/learning/learning-completion.server";
import {
  findEffectiveEnrollmentProgressOverride,
  findEffectiveModuleCompletion,
} from "#/server/learning/progress-overrides.server";

const PAGE_SIZE = 20;
const adminDateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Australia/Sydney",
});

function adminDateTimeLabel(value: Date): string {
  return adminDateTimeFormatter.format(value);
}

function learnerPredicate() {
  return sql<boolean>`not exists (
    select 1 from platform_admin
    where platform_admin."userId" = "user".id
  )`;
}

function searchPattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function findAdminOverview(
  administrator: AuthenticatedUser,
): Promise<AdminOverview> {
  const database = getDatabase();
  const [learnerCount, enrollmentStats, orderStats] = await Promise.all([
    database
      .selectFrom("user")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where(learnerPredicate())
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("enrollment")
      .select([
        sql<number>`count(*) filter (
          where status = 'active'
            and "removedAt" is null
            and ("expiresAt" is null or "expiresAt" > now())
        )::integer`.as("active"),
        sql<number>`count(*) filter (where status = 'completed')::integer`.as(
          "completed",
        ),
      ])
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("order")
      .select([
        sql<number>`count(*) filter (where status = 'paid')::integer`.as(
          "paidOrders",
        ),
        sql<number>`coalesce(sum("totalCents") filter (where status = 'paid'), 0)::integer`.as(
          "paidRevenueCents",
        ),
      ])
      .executeTakeFirstOrThrow(),
  ]);

  return {
    administrator: { name: administrator.name, email: administrator.email },
    statistics: {
      learners: learnerCount.count,
      activeEnrollments: enrollmentStats.active,
      completedEnrollments: enrollmentStats.completed,
      paidOrders: orderStats.paidOrders,
      paidRevenueCents: orderStats.paidRevenueCents,
    },
  };
}

export async function findAdminLearners(
  input: AdminLearnerSearch,
): Promise<AdminLearnerDirectory> {
  const database = getDatabase();
  const pattern = searchPattern(input.q);
  const countRow = await database
    .selectFrom("user")
    .where(learnerPredicate())
    .$if(input.q.length > 0, (builder) =>
      builder.where((expression) =>
        expression.or([
          expression("user.name", "ilike", pattern),
          expression("user.email", "ilike", pattern),
        ]),
      ),
    )
    .select(sql<number>`count(*)::integer`.as("count"))
    .executeTakeFirstOrThrow();
  const pages = Math.max(1, Math.ceil(countRow.count / PAGE_SIZE));
  const page = Math.min(input.page, pages);
  const rows = await database
    .selectFrom("user")
    .leftJoin("enrollment", "enrollment.userId", "user.id")
    .where(learnerPredicate())
    .$if(input.q.length > 0, (builder) =>
      builder.where((expression) =>
        expression.or([
          expression("user.name", "ilike", pattern),
          expression("user.email", "ilike", pattern),
        ]),
      ),
    )
    .select([
      "user.id",
      "user.name",
      "user.email",
      "user.createdAt",
      sql<number>`count("enrollment".id)::integer`.as("enrollments"),
      sql<number>`count("enrollment".id) filter (
        where "enrollment".status = 'active'
          and "enrollment"."removedAt" is null
          and ("enrollment"."expiresAt" is null or "enrollment"."expiresAt" > now())
      )::integer`.as("activeEnrollments"),
      sql<number>`count("enrollment".id) filter (
        where "enrollment".status = 'completed'
      )::integer`.as("completedEnrollments"),
    ])
    .groupBy(["user.id", "user.name", "user.email", "user.createdAt"])
    .orderBy("user.name")
    .orderBy("user.id")
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();

  return {
    learners: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      joinedAt: row.createdAt.toISOString(),
      enrollments: row.enrollments,
      activeEnrollments: row.activeEnrollments,
      completedEnrollments: row.completedEnrollments,
    })),
    pagination: { page, pages, total: countRow.count },
    query: input.q,
  };
}

export async function findAdminLearnerProfile(
  userId: string,
): Promise<AdminLearnerProfile | null> {
  const database = getDatabase();
  const learner = await database
    .selectFrom("user")
    .select(["id", "name", "email", "createdAt"])
    .where("id", "=", userId)
    .where(learnerPredicate())
    .executeTakeFirst();
  if (!learner) return null;

  const rows = await database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .leftJoin("scorm_attempt", "scorm_attempt.enrollmentId", "enrollment.id")
    .select([
      "enrollment.id",
      "enrollment.courseVersionId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug as courseSlug",
      "course.title as courseTitle",
      "course_version.version as courseVersion",
      sql<Date | null>`max("scorm_attempt"."lastActivityAt")`.as(
        "lastActivityAt",
      ),
    ])
    .where("enrollment.userId", "=", userId)
    .groupBy([
      "enrollment.id",
      "enrollment.courseVersionId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug",
      "course.title",
      "course_version.version",
    ])
    .orderBy("enrollment.enrolledAt", "desc")
    .execute();
  const moduleCompletionByEnrollment = new Map(
    await Promise.all(
      rows.map(
        async (row) =>
          [
            row.id,
            await findEffectiveModuleCompletion(
              database,
              row.id,
              row.courseVersionId,
            ),
          ] as const,
      ),
    ),
  );

  return {
    learner: {
      id: learner.id,
      name: learner.name,
      email: learner.email,
      joinedAt: learner.createdAt.toISOString(),
    },
    enrollments: rows.map((row) => {
      const moduleCompletion = moduleCompletionByEnrollment.get(row.id) ?? [];
      return {
        id: row.id,
        courseSlug: row.courseSlug,
        courseTitle: row.courseTitle,
        courseVersion: row.courseVersion,
        status: row.removedAt
          ? "cancelled"
          : row.expiresAt && row.expiresAt <= new Date()
            ? "expired"
            : row.status,
        enrolledAt: row.enrolledAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        removedAt: row.removedAt?.toISOString() ?? null,
        moduleCount: moduleCompletion.length,
        completedModuleCount: moduleCompletion.filter(
          (module) => module.state === "completed",
        ).length,
        lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      };
    }),
  };
}

function enrollmentAccessStatus(enrollment: {
  status: string;
  expiresAt: Date | null;
  removedAt: Date | null;
}): "active" | "expired" | "cancelled" {
  if (enrollment.removedAt || enrollment.status === "cancelled")
    return "cancelled";
  if (
    enrollment.status === "expired" ||
    (enrollment.expiresAt && enrollment.expiresAt <= new Date())
  )
    return "expired";
  return "active";
}

export async function findAdminEnrollmentDetail(
  userId: string,
  enrollmentId: string,
): Promise<AdminEnrollmentDetail | null> {
  const database = getDatabase();
  const enrollment = await database
    .selectFrom("enrollment")
    .innerJoin("user", "user.id", "enrollment.userId")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "enrollment.id",
      "enrollment.courseVersionId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "user.id as learnerId",
      "user.name as learnerName",
      "user.email as learnerEmail",
      "course.title as courseTitle",
      "course_version.version as courseVersion",
      "course_version.content",
    ])
    .where("enrollment.id", "=", enrollmentId)
    .where("enrollment.userId", "=", userId)
    .where(learnerPredicate())
    .executeTakeFirst();
  if (!enrollment) return null;

  const [
    moduleCompletion,
    completionOverride,
    attemptRows,
    historyRows,
    sectionRows,
    itemRows,
    itemProgress,
  ] = await Promise.all([
    findEffectiveModuleCompletion(
      database,
      enrollment.id,
      enrollment.courseVersionId,
    ),
    findEffectiveEnrollmentProgressOverride(
      database,
      enrollment.id,
      enrollment.completedAt,
    ),
    database
      .selectFrom("scorm_attempt")
      .select([
        "modulePosition",
        sql<number>`count(*)::integer`.as("attemptCount"),
        sql<Date | null>`max("lastActivityAt")`.as("latestActivityAt"),
      ])
      .where("enrollmentId", "=", enrollment.id)
      .groupBy("modulePosition")
      .execute(),
    database
      .selectFrom("learning_progress_override")
      .innerJoin("user", "user.id", "learning_progress_override.actorUserId")
      .select([
        "learning_progress_override.id",
        "learning_progress_override.scope",
        "learning_progress_override.modulePosition",
        "learning_progress_override.state",
        "learning_progress_override.reason",
        "learning_progress_override.createdAt",
        "user.name as administratorName",
      ])
      .where("learning_progress_override.enrollmentId", "=", enrollment.id)
      .orderBy("learning_progress_override.sequence", "desc")
      .limit(50)
      .execute(),
    database
      .selectFrom("course_version_section")
      .select(["id", "title", "description", "position"])
      .where("courseVersionId", "=", enrollment.courseVersionId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("course_version_item")
      .select([
        "id",
        "sectionId",
        "kind",
        "title",
        "required",
        "modulePosition",
        "position",
      ])
      .where("courseVersionId", "=", enrollment.courseVersionId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("learning_item_progress")
      .select("courseVersionItemId")
      .where("enrollmentId", "=", enrollment.id)
      .where("state", "=", "completed")
      .execute(),
  ]);
  const attemptByPosition = new Map(
    attemptRows.map((attempt) => [attempt.modulePosition, attempt]),
  );
  const content = courseContentSchema.parse(enrollment.content);
  const completedModulePositions = new Set(
    moduleCompletion
      .filter((module) => module.state === "completed")
      .map((module) => module.position),
  );
  const completedItemIds = new Set(
    itemProgress.map((item) => item.courseVersionItemId),
  );

  return {
    learner: {
      id: enrollment.learnerId,
      name: enrollment.learnerName,
      email: enrollment.learnerEmail,
    },
    enrollment: {
      id: enrollment.id,
      courseTitle: enrollment.courseTitle,
      courseVersion: enrollment.courseVersion,
      accessStatus: enrollmentAccessStatus(enrollment),
      completionState:
        completionOverride?.state ??
        (enrollment.status === "completed" ? "completed" : "incomplete"),
      completionSource: completionOverride ? "administrator" : "system",
      enrolledAt: enrollment.enrolledAt.toISOString(),
      enrolledAtLabel: adminDateTimeLabel(enrollment.enrolledAt),
      completedAt: enrollment.completedAt?.toISOString() ?? null,
      completedAtLabel: enrollment.completedAt
        ? adminDateTimeLabel(enrollment.completedAt)
        : null,
      expiresAt: enrollment.expiresAt?.toISOString() ?? null,
    },
    modules: moduleCompletion.map((module) => {
      const definition = content.modules[module.position];
      const attempt = attemptByPosition.get(module.position);
      return {
        position: module.position,
        title: definition?.title ?? `Module ${String(module.position + 1)}`,
        phase: definition?.phase ?? "content",
        durationMinutes: definition?.durationMinutes ?? 0,
        state: module.state,
        source: module.source,
        attemptCount: attempt?.attemptCount ?? 0,
        latestActivityAt: attempt?.latestActivityAt?.toISOString() ?? null,
        latestActivityAtLabel: attempt?.latestActivityAt
          ? adminDateTimeLabel(attempt.latestActivityAt)
          : null,
      };
    }),
    sections: sectionRows.map((section) => {
      const items = itemRows
        .filter((item) => item.sectionId === section.id)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          required: item.required,
          state:
            (item.kind === "scorm" &&
              item.modulePosition !== null &&
              completedModulePositions.has(item.modulePosition)) ||
            completedItemIds.has(item.id)
              ? ("completed" as const)
              : ("incomplete" as const),
        }));
      const requiredItems = items.filter((item) => item.required);
      const targets = requiredItems.length > 0 ? requiredItems : items;
      return {
        id: section.id,
        title: section.title,
        description: section.description,
        state:
          targets.length > 0 &&
          targets.every((item) => item.state === "completed")
            ? ("completed" as const)
            : ("incomplete" as const),
        completedItems: items.filter((item) => item.state === "completed")
          .length,
        totalItems: items.length,
        items,
      };
    }),
    overrideHistory: historyRows.map((override) => ({
      id: override.id,
      scope: override.scope,
      modulePosition: override.modulePosition,
      state: override.state,
      administratorName: override.administratorName,
      reason: override.reason,
      createdAt: override.createdAt.toISOString(),
      createdAtLabel: adminDateTimeLabel(override.createdAt),
    })),
  };
}

export async function applyAdminProgressOverride(
  input: AdminProgressOverrideInput,
  administrator: AuthenticatedUser,
): Promise<"changed" | "unchanged" | "not-found"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const enrollment = await transaction
        .selectFrom("enrollment")
        .innerJoin("user", "user.id", "enrollment.userId")
        .select([
          "enrollment.id",
          "enrollment.userId",
          "enrollment.courseVersionId",
          "enrollment.status",
          "enrollment.completedAt",
          "enrollment.removedAt",
        ])
        .where("enrollment.id", "=", input.enrollmentId)
        .where(learnerPredicate())
        .forUpdate()
        .executeTakeFirst();
      if (!enrollment) return "not-found";

      let previousState: "completed" | "incomplete";
      if (input.scope === "module") {
        const modules = await findEffectiveModuleCompletion(
          transaction,
          enrollment.id,
          enrollment.courseVersionId,
        );
        const module = modules.find(
          (candidate) => candidate.position === input.modulePosition,
        );
        if (!module) return "not-found";
        previousState = module.state;
      } else {
        const latest = await findEffectiveEnrollmentProgressOverride(
          transaction,
          enrollment.id,
          enrollment.completedAt,
        );
        previousState =
          latest?.state ??
          (enrollment.status === "completed" ? "completed" : "incomplete");
      }
      if (previousState === input.state) return "unchanged";

      const now = new Date();
      const overrideId = randomUUID();
      await transaction
        .insertInto("learning_progress_override")
        .values({
          id: overrideId,
          enrollmentId: enrollment.id,
          scope: input.scope,
          modulePosition: input.modulePosition,
          state: input.state,
          actorUserId: administrator.id,
          reason: null,
          createdAt: now,
        })
        .execute();
      await enqueueAuditLogProjection(
        transaction,
        {
          eventId: overrideId,
          event: "learning.progress_overridden",
          actorUserId: administrator.id,
          entityType: input.scope,
          entityId:
            input.scope === "module"
              ? `${enrollment.id}:${String(input.modulePosition)}`
              : enrollment.id,
          aggregateId: enrollment.id,
          outcome: "succeeded",
        },
        now,
      );

      let desiredCompletion: "completed" | "incomplete" | null = null;
      if (input.scope === "enrollment") {
        desiredCompletion = input.state;
      } else if (
        !(await findEffectiveEnrollmentProgressOverride(
          transaction,
          enrollment.id,
          enrollment.completedAt,
        ))
      ) {
        desiredCompletion = (await isLearningComplete(
          transaction,
          enrollment.id,
          enrollment.courseVersionId,
        ))
          ? "completed"
          : "incomplete";
      }

      if (desiredCompletion) {
        const currentlyCompleted = enrollment.status === "completed";
        const shouldComplete = desiredCompletion === "completed";
        if (currentlyCompleted !== shouldComplete) {
          await transaction
            .updateTable("enrollment")
            .set({
              status:
                enrollment.removedAt ||
                enrollment.status === "cancelled" ||
                enrollment.status === "expired"
                  ? enrollment.status
                  : shouldComplete
                    ? "completed"
                    : "active",
              completedAt: shouldComplete ? now : null,
            })
            .where("id", "=", enrollment.id)
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto("outbox_event")
            .values({
              id: randomUUID(),
              topic: shouldComplete
                ? "enrollment.completed"
                : "enrollment.completion_revoked",
              aggregateId: enrollment.id,
              payload: {
                enrollmentId: enrollment.id,
                courseVersionId: enrollment.courseVersionId,
                source: "administrator",
                actorUserId: administrator.id,
                overrideId,
              },
              availableAt: now,
              processedAt: null,
              createdAt: now,
            })
            .execute();
        }
      }
      return "changed";
    });
}
