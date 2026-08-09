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
import { getDatabase } from "#/server/db/database.server";
import {
  findEffectiveModuleCompletion,
  findLatestEnrollmentProgressOverride,
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
    .leftJoin(
      "course_version_module",
      "course_version_module.courseVersionId",
      "course_version.id",
    )
    .leftJoin("scorm_attempt", (join) =>
      join
        .onRef("scorm_attempt.enrollmentId", "=", "enrollment.id")
        .onRef(
          "scorm_attempt.modulePosition",
          "=",
          "course_version_module.position",
        ),
    )
    .select([
      "enrollment.id",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug as courseSlug",
      "course.title as courseTitle",
      "course_version.version as courseVersion",
      sql<number>`count(distinct "course_version_module".position)::integer`.as(
        "moduleCount",
      ),
      sql<number>`count(distinct "scorm_attempt"."modulePosition") filter (
        where "scorm_attempt".status = 'completed'
      )::integer`.as("completedModuleCount"),
      sql<Date | null>`max("scorm_attempt"."lastActivityAt")`.as(
        "lastActivityAt",
      ),
    ])
    .where("enrollment.userId", "=", userId)
    .groupBy([
      "enrollment.id",
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

  return {
    learner: {
      id: learner.id,
      name: learner.name,
      email: learner.email,
      joinedAt: learner.createdAt.toISOString(),
    },
    enrollments: rows.map((row) => ({
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
      moduleCount: row.moduleCount,
      completedModuleCount: row.completedModuleCount,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    })),
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

  const [moduleCompletion, completionOverride, attemptRows, historyRows] =
    await Promise.all([
      findEffectiveModuleCompletion(
        database,
        enrollment.id,
        enrollment.courseVersionId,
      ),
      findLatestEnrollmentProgressOverride(database, enrollment.id),
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
    ]);
  const actorIds = new Set(
    moduleCompletion.flatMap((module) =>
      module.override ? [module.override.actorUserId] : [],
    ),
  );
  if (completionOverride) actorIds.add(completionOverride.actorUserId);
  const actors =
    actorIds.size === 0
      ? []
      : await database
          .selectFrom("user")
          .select(["id", "name"])
          .where("id", "in", [...actorIds])
          .execute();
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const attemptByPosition = new Map(
    attemptRows.map((attempt) => [attempt.modulePosition, attempt]),
  );
  const content = courseContentSchema.parse(enrollment.content);

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
      completionOverride: completionOverride
        ? {
            administratorName:
              actorNames.get(completionOverride.actorUserId) ??
              "Former administrator",
            reason: completionOverride.reason,
            createdAt: completionOverride.createdAt.toISOString(),
            createdAtLabel: adminDateTimeLabel(completionOverride.createdAt),
          }
        : null,
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
        override: module.override
          ? {
              administratorName:
                actorNames.get(module.override.actorUserId) ??
                "Former administrator",
              reason: module.override.reason,
              createdAt: module.override.createdAt.toISOString(),
              createdAtLabel: adminDateTimeLabel(module.override.createdAt),
            }
          : null,
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
        const latest = await findLatestEnrollmentProgressOverride(
          transaction,
          enrollment.id,
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
          reason: input.reason,
          createdAt: now,
        })
        .execute();
      await transaction
        .insertInto("audit_event")
        .values({
          id: randomUUID(),
          actorUserId: administrator.id,
          action: "learning.progress_overridden",
          subjectType: input.scope,
          subjectId:
            input.scope === "module"
              ? `${enrollment.id}:${String(input.modulePosition)}`
              : enrollment.id,
          reason: input.reason,
          metadata: {
            overrideId,
            enrollmentId: enrollment.id,
            learnerUserId: enrollment.userId,
            courseVersionId: enrollment.courseVersionId,
            modulePosition: input.modulePosition,
            previousState,
            state: input.state,
          },
          createdAt: now,
        })
        .execute();

      let desiredCompletion: "completed" | "incomplete" | null = null;
      if (input.scope === "enrollment") {
        desiredCompletion = input.state;
      } else if (
        !(await findLatestEnrollmentProgressOverride(
          transaction,
          enrollment.id,
        ))
      ) {
        const modules = await findEffectiveModuleCompletion(
          transaction,
          enrollment.id,
          enrollment.courseVersionId,
        );
        desiredCompletion =
          modules.length > 0 &&
          modules.every((module) => module.state === "completed")
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
