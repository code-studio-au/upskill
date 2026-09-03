import { sql, type Kysely } from "kysely";

const migrationScheduleIdPrefix =
  "event_operational_communication_schedule_migration_0081_";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  // Migration 0081 introduced regional-review schedules for existing events.
  // Suppress only its already-due backfill before the worker starts, while
  // preserving future schedules created by that migration.
  await sql`
    with overdue_reviews as (
      select distinct review.id, schedule."eventOccurrenceId"
        from event_operational_communication_schedule schedule
        inner join event_region_review_round review
          on review.id = schedule."eventRegionReviewRoundId"
       where left(schedule.id, ${migrationScheduleIdPrefix.length}) = ${migrationScheduleIdPrefix}
         and schedule.kind = 'regional_lock_due'
         and schedule.status in ('pending', 'processing')
         and schedule."dueAt" <= statement_timestamp()
         and review."lockedAt" is null
    ), locked_reviews as (
      update event_region_review_round review
         set "lockedAt" = statement_timestamp(),
             "lockedByUserId" = null,
             "lockSource" = 'deadline'
        from overdue_reviews overdue
       where review.id = overdue.id
      returning review.id
    )
    insert into audit_event
      (id, "actorUserId", action, "subjectType", "subjectId", reason, metadata, "createdAt")
    select 'audit_migration_0084_' || md5(overdue.id),
           null,
           'event_region_review.locked',
           'event_region_review_round',
           overdue.id,
           'historical_schedule_reconciled',
           jsonb_build_object(
             'source', 'deadline',
             'reconciledBy', 'migration_0084',
             'notificationsSuppressed', true
           ),
           statement_timestamp()
      from overdue_reviews overdue
      inner join locked_reviews locked on locked.id = overdue.id
    on conflict (id) do nothing
  `.execute(db);

  await sql`
    insert into outbox_event
      (id, topic, "aggregateId", payload, attempts, "availableAt", "processedAt", "createdAt")
    select 'outbox_migration_0084_' || md5(review.id),
           'audit.log_requested',
           schedule."eventOccurrenceId",
           jsonb_build_object(
             'version', 1,
             'eventId', audit.id,
             'event', audit.action,
             'actorUserId', audit."actorUserId",
             'entityType', audit."subjectType",
             'entityId', audit."subjectId",
             'aggregateId', schedule."eventOccurrenceId",
             'outcome', 'succeeded',
             'reasonCode', audit.reason
           ),
           0,
           audit."createdAt",
           null,
           audit."createdAt"
      from audit_event audit
      inner join event_region_review_round review
        on review.id = audit."subjectId"
      inner join event_operational_communication_schedule schedule
        on schedule."eventRegionReviewRoundId" = review.id
       and schedule.kind = 'regional_lock_due'
     where audit.id = 'audit_migration_0084_' || md5(review.id)
       and left(schedule.id, ${migrationScheduleIdPrefix.length}) = ${migrationScheduleIdPrefix}
    on conflict (id) do nothing
  `.execute(db);

  await sql`
    update event_operational_communication_schedule
       set status = 'completed',
           "recipientCount" = 0,
           "processedAt" = statement_timestamp(),
           "lastErrorCode" = null,
           "updatedAt" = statement_timestamp()
     where left(id, ${migrationScheduleIdPrefix.length}) = ${migrationScheduleIdPrefix}
       and status in ('pending', 'processing')
       and "dueAt" <= statement_timestamp()
  `.execute(db);
}

export async function down(): Promise<void> {
  // The reconciliation records durable lock evidence and may run before a
  // worker can emit external notifications. Reversing it would be unsafe.
}
