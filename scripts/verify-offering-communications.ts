import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  findAdminCommunicationWorkspace,
  materializeEventOccurrenceCommunications,
  overrideOccurrenceCommunication,
  previewOfferingCommunication,
  resetOccurrenceCommunication,
  saveCourseCommunicationPlan,
  saveEventTemplateCommunicationPlan,
} from "#/server/admin/admin-communication.server";
import {
  createAdminCourseVersion,
  saveAdminCourseDraft,
} from "#/server/admin/admin-course.server";
import {
  createAdminEventTemplateVersion,
  saveAdminEventTemplateDraft,
} from "#/server/admin/admin-event.server";
import {
  createAdminOfferingEmail,
  publishAdminEmailVersion,
  saveAdminEmailDraft,
} from "#/server/admin/admin-email.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import {
  enqueueRegistrationSubmittedEventCommunications,
  enqueueRegistrationSelectedEventCommunications,
  enqueueEventParticipationCommunications,
  processNextEventCommunicationSchedule,
  refreshEventCommunicationSchedules,
} from "#/server/notifications/event-communication-execution.server";
import { enqueueCourseEnrollmentCommunications } from "#/server/notifications/course-communication-execution.server";
import { deliverNotification } from "#/server/notifications/notification-delivery.server";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";
import { ensureEventSectionReleased } from "#/server/learning/event-section-release.server";

const database = getDatabase();
const suffix = randomUUID();
const actor = {
  id: `verify_communication_actor_${suffix}`,
  name: "Communication plan verifier",
  email: `communication-${suffix}@example.com`,
  emailVerified: true,
};

try {
  const now = new Date();
  await database
    .insertInto("user")
    .values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      phone: null,
      currentRegionId: null,
      profileData: {},
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: actor.id, grantedByUserId: null, createdAt: now })
    .execute();

  const courseEmail = await createAdminOfferingEmail(
    { name: "Course reminder", contextKey: "offering_course" },
    actor,
  );
  assert.equal(
    await saveAdminEmailDraft({
      ...courseEmail,
      subject: "Continue {{course.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nYou are {{enrolment.progressPercent}} through {{course.title}}.",
    }),
    "saved",
  );
  assert.equal(await publishAdminEmailVersion(courseEmail, actor), "published");

  const unpublishedEventEmail = await createAdminOfferingEmail(
    { name: "Unpublished event reminder", contextKey: "offering_event" },
    actor,
  );
  const eventEmail = await createAdminOfferingEmail(
    { name: "Event reminder", contextKey: "offering_event" },
    actor,
  );
  assert.equal(
    await saveAdminEmailDraft({
      ...eventEmail,
      subject: "Reminder: {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\n{{event.title}} begins {{event.startsAt}}.\n\n{{section.title}}: {{session.title}} starts {{session.startsAt}} at {{session.locationSummary}} with {{session.presenterNames}}.",
    }),
    "saved",
  );
  assert.equal(await publishAdminEmailVersion(eventEmail, actor), "published");

  const courseId = `verify_communication_course_${suffix}`;
  const courseVersionId = `verify_communication_course_version_${suffix}`;
  const courseSectionId = `verify_communication_course_section_${suffix}`;
  const courseCommunicationId = `verify_communication_course_plan_${suffix}`;
  const courseCreatedCommunicationId = `verify_communication_course_created_${suffix}`;
  const courseCompletedCommunicationId = `verify_communication_course_completed_${suffix}`;
  const courseExpiringCommunicationId = `verify_communication_course_expiring_${suffix}`;
  await database
    .insertInto("course")
    .values({
      id: courseId,
      slug: `communication-course-${suffix}`,
      title: "Communication course",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: courseVersionId,
      courseId,
      version: 1,
      content: {},
      publishedAt: null,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("course_version_section")
    .values({
      id: courseSectionId,
      courseVersionId,
      position: 0,
      title: "Course section",
      description: "",
      createdAt: now,
    })
    .execute();
  assert.equal(
    await saveAdminCourseDraft(
      {
        courseId,
        versionId: courseVersionId,
        slug: `communication-course-${suffix}`,
        title: "Communication course",
        summary: "Communication course summary",
        description: "Communication course description",
        topic: "leadership",
        durationMinutes: 60,
        priceCents: 10000,
        salePriceCents: null,
        bulkPricing: { enabled: false, tiers: [] },
        featured: false,
        listInStore: true,
        coverImage: null,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        sections: [
          {
            id: courseSectionId,
            title: "Renamed course section",
            description: "",
            items: [
              {
                id: courseCommunicationId,
                kind: "automated_email",
                title: "Incomplete course reminder",
                emailDesignVersionId: courseEmail.versionId,
                audience: "active_enrollees",
                trigger: "course_incomplete",
                offsetAmount: 7,
                offsetUnit: "day",
                subjectOverride: null,
                textBodyOverride: null,
              },
              {
                id: courseCreatedCommunicationId,
                kind: "automated_email",
                title: "Enrollment created",
                emailDesignVersionId: courseEmail.versionId,
                audience: "affected_learner",
                trigger: "enrollment_created",
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Welcome to {{course.title}}",
                textBodyOverride: null,
              },
              {
                id: courseCompletedCommunicationId,
                kind: "automated_email",
                title: "Enrollment completed",
                emailDesignVersionId: courseEmail.versionId,
                audience: "affected_learner",
                trigger: "enrollment_completed",
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Completed {{course.title}}",
                textBodyOverride: null,
              },
              {
                id: courseExpiringCommunicationId,
                kind: "automated_email",
                title: "Enrollment expiring",
                emailDesignVersionId: courseEmail.versionId,
                audience: "affected_learner",
                trigger: "enrollment_expiring",
                offsetAmount: -1,
                offsetUnit: "day",
                subjectOverride: "Expiring {{course.title}}",
                textBodyOverride: null,
              },
            ],
          },
        ],
      },
      actor,
    ),
    "saved",
  );
  const courseWorkspace = await findAdminCommunicationWorkspace({
    kind: "course",
    courseVersionId,
  });
  assert.ok(courseWorkspace);
  assert.equal(courseWorkspace.items.length, 4);
  assert.ok(
    courseWorkspace.variableGroups.some(
      (group) =>
        group.group === "Course" &&
        group.items.some((variable) => variable.value === "course.title"),
    ),
  );
  assert.equal(
    courseWorkspace.templates.find(
      (template) => template.versionId === courseEmail.versionId,
    )?.textBody,
    "Hello {{user.firstName}},\n\nYou are {{enrolment.progressPercent}} through {{course.title}}.",
  );
  const courseItem = courseWorkspace.items[0];
  assert.ok(courseItem);
  assert.equal(courseItem.sectionId, courseSectionId);
  assert.equal(courseItem.position, 0);
  const coursePreview = await previewOfferingCommunication(
    { kind: "course", courseVersionId },
    { communicationId: courseItem.id },
  );
  assert.equal(coursePreview?.subject, "Continue Communication course");
  const unsavedCoursePreview = await previewOfferingCommunication(
    { kind: "course", courseVersionId },
    {
      emailDesignVersionId: courseEmail.versionId,
      subject: "Reminder: {{course.title}}",
      textBody: "Return to {{course.dashboardUrl}}.",
    },
  );
  assert.equal(unsavedCoursePreview?.subject, "Reminder: Communication course");
  await database
    .updateTable("course_version")
    .set({ publishedAt: now })
    .where("id", "=", courseVersionId)
    .execute();
  assert.equal(
    await saveCourseCommunicationPlan(
      {
        courseVersionId,
        label: "Changed reminder",
        emailDesignVersionId: courseEmail.versionId,
        sectionId: courseSectionId,
        sessionDefinitionId: null,
        audience: "active_enrollees",
        trigger: "course_incomplete",
        offsetAmount: 1,
        offsetUnit: "day",
        subjectOverride: null,
        textBodyOverride: null,
      },
      actor,
    ),
    "conflict",
  );
  await assert.rejects(
    database
      .updateTable("course_version_communication")
      .set({ label: "Direct mutation" })
      .where("courseVersionId", "=", courseVersionId)
      .execute(),
    /immutable/iu,
  );
  const copiedCourseVersion = await createAdminCourseVersion(courseId, actor);
  assert.equal(copiedCourseVersion.status, "created");
  const copiedCoursePlan = await database
    .selectFrom("course_version_communication")
    .select("sectionId")
    .where("courseVersionId", "=", copiedCourseVersion.versionId)
    .executeTakeFirstOrThrow();
  assert.ok(copiedCoursePlan.sectionId);

  const unrelatedCourseUserId = `verify_communication_unrelated_course_user_${suffix}`;
  await database
    .insertInto("user")
    .values({
      id: unrelatedCourseUserId,
      name: "Unrelated active learner",
      email: `communication-unrelated-${suffix}@example.com`,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      phone: null,
      currentRegionId: null,
      profileData: {},
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: `verify_communication_unrelated_enrollment_${suffix}`,
      userId: unrelatedCourseUserId,
      courseVersionId,
      accessGrantId: null,
      status: "active",
      enrolledAt: now,
      completedAt: null,
      expiresAt: null,
      removedAt: null,
    })
    .execute();

  const courseEnrollment = await database.transaction().execute(
    async (transaction) =>
      await issueCourseEntitlement(transaction, {
        userId: actor.id,
        userEmail: actor.email,
        courseVersionId,
        enrollmentDurationDays: 30,
        enrollmentAccessGrantId: null,
        origin: { type: "administrator" },
        createdAt: now,
        eventSource: "administrator",
      }),
  );
  await database.transaction().execute(async (transaction) => {
    const completedAt = new Date(now.getTime() + 60_000);
    await transaction
      .updateTable("enrollment")
      .set({ status: "completed", completedAt })
      .where("id", "=", courseEnrollment.enrollmentId)
      .executeTakeFirstOrThrow();
    await enqueueCourseEnrollmentCommunications(transaction, {
      enrollmentId: courseEnrollment.enrollmentId,
      triggerEventId: `verify_course_completed_${suffix}`,
      triggers: ["enrollment_completed"],
      createdAt: completedAt,
    });
  });
  const courseNotifications = await database
    .selectFrom("notification")
    .select(["id", "payload"])
    .where("templateKey", "=", "offering_course")
    .where("recipientUserId", "=", actor.id)
    .execute();
  assert.equal(
    await database
      .selectFrom("notification")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("templateKey", "=", "offering_course")
      .where("recipientUserId", "=", unrelatedCourseUserId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    0,
    "Course trigger audiences must not fan out one learner's lifecycle event to unrelated active enrolments",
  );
  assert.deepEqual(
    new Set(
      courseNotifications.map(
        (notification) => (notification.payload as { trigger: string }).trigger,
      ),
    ),
    new Set([
      "course_incomplete",
      "enrollment_completed",
      "enrollment_created",
      "enrollment_expiring",
    ]),
  );
  for (const notification of courseNotifications) {
    const trigger = (notification.payload as { trigger: string }).trigger;
    assert.deepEqual(await deliverNotification(notification.id), {
      status:
        trigger === "enrollment_created" || trigger === "enrollment_completed"
          ? "delivered"
          : "superseded",
    });
  }

  const eventTemplateId = `verify_communication_event_template_${suffix}`;
  const eventTemplateVersionId = `verify_communication_event_version_${suffix}`;
  const eventSectionId = `verify_communication_event_section_${suffix}`;
  const eventSessionItemId = `verify_communication_event_item_${suffix}`;
  const eventCommunicationId = `verify_communication_event_plan_${suffix}`;
  const eventSelectedCommunicationId = `verify_communication_event_selected_plan_${suffix}`;
  const eventSubmittedCommunicationId = `verify_communication_event_submitted_plan_${suffix}`;
  const eventEndCommunicationId = `verify_communication_event_end_plan_${suffix}`;
  const eventSessionCommunicationId = `verify_communication_event_session_plan_${suffix}`;
  const eventReleaseCommunicationId = `verify_communication_event_release_plan_${suffix}`;
  const eventCompletedCommunicationId = `verify_communication_event_completed_plan_${suffix}`;
  const eventSessionDefinitionId = `verify_communication_event_session_${suffix}`;
  await database
    .insertInto("event_template")
    .values({
      id: eventTemplateId,
      title: "Communication event",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: eventTemplateVersionId,
      eventTemplateId,
      version: 1,
      summary: "",
      description: "",
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      publishedAt: null,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version_section")
    .values({
      id: eventSectionId,
      eventTemplateVersionId,
      position: 0,
      title: "Pre-event",
      description: "",
      phase: "pre_event",
      releaseAnchor: "participation_created",
      releaseOffsetAmount: 0,
      releaseOffsetUnit: "minute",
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_session_definition")
    .values({
      id: eventSessionDefinitionId,
      eventTemplateVersionId,
      position: 0,
      title: "Workshop session",
      durationMinutes: 60,
      presenterRequired: false,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version_item")
    .values({
      id: eventSessionItemId,
      eventTemplateVersionId,
      sectionId: eventSectionId,
      position: 0,
      kind: "session",
      title: "Workshop session",
      required: true,
      durationMinutes: 60,
      learningActivityVersionId: null,
      sessionDefinitionId: eventSessionDefinitionId,
      createdAt: now,
    })
    .execute();
  assert.equal(
    await saveEventTemplateCommunicationPlan(
      {
        eventTemplateVersionId,
        label: "Event starts tomorrow",
        emailDesignVersionId: unpublishedEventEmail.versionId,
        sectionId: eventSectionId,
        sessionDefinitionId: null,
        audience: "confirmed_participants",
        trigger: "event_start",
        offsetAmount: -1,
        offsetUnit: "day",
        subjectOverride: null,
        textBodyOverride: null,
      },
      actor,
    ),
    "conflict",
  );
  assert.equal(
    await saveAdminEventTemplateDraft(
      {
        eventTemplateId,
        eventTemplateVersionId,
        title: "Communication event",
        topic: "Clinical workshops",
        summary: "Communication event summary",
        description: "Communication event description",
        coverImage: null,
        hasCompletionCertificate: false,
        accreditations: [],
        defaultAdministratorIds: [actor.id],
        regions: [],
        sections: [
          {
            id: eventSectionId,
            title: "Renamed pre-event",
            description: "",
            phase: "pre_event",
            releaseAnchor: "participation_created",
            releaseOffsetAmount: 0,
            releaseOffsetUnit: "minute",
            items: [
              {
                id: eventCommunicationId,
                kind: "automated_email",
                title: "Event starts tomorrow",
                emailDesignVersionId: eventEmail.versionId,
                audience: "confirmed_participants",
                trigger: "event_start",
                sessionItemId: eventSessionItemId,
                offsetAmount: -1,
                offsetUnit: "day",
                subjectOverride: "Your event: {{event.title}}",
                textBodyOverride: null,
              },
              {
                id: eventSelectedCommunicationId,
                kind: "automated_email",
                title: "Registration selected",
                emailDesignVersionId: eventEmail.versionId,
                audience: "affected_learner",
                trigger: "registration_selected",
                sessionItemId: eventSessionItemId,
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Confirmed: {{event.title}}",
                textBodyOverride:
                  "Hello {{user.firstName}},\n\nYour {{registration.status}} place for {{event.title}} is confirmed. View {{event.dashboardUrl}}.",
              },
              {
                id: eventSubmittedCommunicationId,
                kind: "automated_email",
                title: "Registration submitted",
                emailDesignVersionId: eventEmail.versionId,
                audience: "affected_learner",
                trigger: "registration_submitted",
                sessionItemId: null,
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Submitted: {{event.title}}",
                textBodyOverride: null,
              },
              {
                id: eventEndCommunicationId,
                kind: "automated_email",
                title: "Event ending",
                emailDesignVersionId: eventEmail.versionId,
                audience: "confirmed_participants",
                trigger: "event_end",
                sessionItemId: null,
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Event ended: {{event.title}}",
                textBodyOverride: null,
              },
              {
                id: eventSessionCommunicationId,
                kind: "automated_email",
                title: "Session starts soon",
                emailDesignVersionId: eventEmail.versionId,
                audience: "confirmed_participants",
                trigger: "session_start",
                sessionItemId: eventSessionItemId,
                offsetAmount: -30,
                offsetUnit: "minute",
                subjectOverride: "Session: {{session.title}}",
                textBodyOverride: null,
              },
              {
                id: eventReleaseCommunicationId,
                kind: "automated_email",
                title: "Section released",
                emailDesignVersionId: eventEmail.versionId,
                audience: "affected_learner",
                trigger: "section_release",
                sessionItemId: null,
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Released: {{section.title}}",
                textBodyOverride: null,
              },
              {
                id: eventCompletedCommunicationId,
                kind: "automated_email",
                title: "Event completed",
                emailDesignVersionId: eventEmail.versionId,
                audience: "affected_learner",
                trigger: "event_completed",
                sessionItemId: null,
                offsetAmount: 0,
                offsetUnit: "minute",
                subjectOverride: "Completed: {{event.title}}",
                textBodyOverride: null,
              },
              {
                id: eventSessionItemId,
                kind: "session",
                title: "Workshop session",
                required: true,
                durationMinutes: 60,
                presenterRequired: false,
                presenterIds: [],
              },
            ],
          },
        ],
      },
      actor,
    ),
    "saved",
  );
  const eventPlanAfterDraftSave = await database
    .selectFrom("event_template_version_communication")
    .select(["sectionId", "sessionDefinitionId", "position"])
    .where("eventTemplateVersionId", "=", eventTemplateVersionId)
    .executeTakeFirstOrThrow();
  assert.equal(eventPlanAfterDraftSave.sectionId, eventSectionId);
  assert.equal(eventPlanAfterDraftSave.position, 0);
  const recreatedSession = await database
    .selectFrom("event_template_version_item")
    .select("sessionDefinitionId")
    .where("id", "=", eventSessionItemId)
    .executeTakeFirstOrThrow();
  const recreatedSessionDefinitionId = recreatedSession.sessionDefinitionId;
  assert.ok(recreatedSessionDefinitionId);
  assert.equal(
    eventPlanAfterDraftSave.sessionDefinitionId,
    recreatedSessionDefinitionId,
  );
  const eventActivityPosition = await database
    .selectFrom("event_template_version_item")
    .select("position")
    .where("eventTemplateVersionId", "=", eventTemplateVersionId)
    .executeTakeFirstOrThrow();
  assert.equal(eventPlanAfterDraftSave.sectionId, eventSectionId);
  assert.equal(eventActivityPosition.position, 7);
  await database
    .updateTable("event_template_version")
    .set({ publishedAt: now })
    .where("id", "=", eventTemplateVersionId)
    .execute();
  const copiedEventVersion = await createAdminEventTemplateVersion(
    eventTemplateId,
    actor,
  );
  assert.equal(copiedEventVersion.status, "created");
  const copiedEventPlan = await database
    .selectFrom("event_template_version_communication")
    .select(["sectionId", "sessionDefinitionId"])
    .where(
      "eventTemplateVersionId",
      "=",
      copiedEventVersion.eventTemplateVersionId,
    )
    .executeTakeFirstOrThrow();
  assert.ok(copiedEventPlan.sectionId);
  assert.ok(copiedEventPlan.sessionDefinitionId);

  const eventOccurrenceId = `verify_communication_occurrence_${suffix}`;
  const eventSessionId = `verify_communication_occurrence_session_${suffix}`;
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("event_occurrence")
      .values({
        id: eventOccurrenceId,
        eventTemplateVersionId,
        title: "Communication event - Sydney",
        slug: `communication-event-${suffix}`,
        status: "draft",
        deliveryMode: "in_person",
        registrationMode: "required_unrestricted",
        approvalMode: "automatic",
        timezone: "Australia/Sydney",
        localStartsAt: "2026-09-15T09:00:00",
        localEndsAt: "2026-09-15T17:00:00",
        localRegistrationOpensAt: null,
        localRegistrationClosesAt: null,
        localCoordinatorLockAt: null,
        startsAt: new Date("2026-09-14T23:00:00.000Z"),
        endsAt: new Date("2026-09-15T07:00:00.000Z"),
        registrationOpensAt: null,
        registrationClosesAt: null,
        coordinatorLockAt: null,
        capacity: 30,
        priceCents: null,
        salePriceCents: null,
        currency: "AUD",
        bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
        listInStore: false,
        featured: false,
        venueName: "Learning Centre",
        venueAddress: "Sydney",
        virtualJoinUrl: null,
        publishedAt: null,
        createdByUserId: actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await transaction
      .insertInto("event_session")
      .values({
        id: eventSessionId,
        eventOccurrenceId,
        sessionDefinitionId: recreatedSessionDefinitionId,
        position: 0,
        title: "Sydney workshop",
        localStartsAt: "2026-09-15T10:00:00",
        localEndsAt: "2026-09-15T12:30:00",
        startsAt: new Date("2026-09-15T00:00:00.000Z"),
        endsAt: new Date("2026-09-15T02:30:00.000Z"),
        presenterRequired: true,
        venueName: "Session room",
        venueAddress: "1 Preview Street",
        virtualJoinUrl: null,
      })
      .execute();
    await transaction
      .insertInto("event_presenter_assignment")
      .values({
        id: `verify_communication_presenter_${suffix}`,
        eventOccurrenceId,
        eventSessionId,
        userId: actor.id,
        scopeKey: eventSessionId,
        source: "occurrence_local",
        assignedByUserId: actor.id,
        assignedAt: now,
        endedAt: null,
        endReason: null,
      })
      .execute();
    await materializeEventOccurrenceCommunications(
      transaction,
      eventOccurrenceId,
      eventTemplateVersionId,
      actor.id,
      now,
    );
  });
  const inheritedWorkspace = await findAdminCommunicationWorkspace({
    kind: "event_occurrence",
    eventOccurrenceId,
  });
  assert.ok(inheritedWorkspace);
  const inherited = inheritedWorkspace.items[0];
  assert.ok(inherited);
  assert.equal(inherited.overrideState, "inherited");
  assert.equal(inherited.subject, "Your event: {{event.title}}");
  const occurrencePreview = await previewOfferingCommunication(
    { kind: "event_occurrence", eventOccurrenceId },
    { communicationId: inherited.id },
  );
  assert.equal(
    occurrencePreview?.subject,
    "Your event: Communication event - Sydney",
  );
  assert.match(
    occurrencePreview.textBody,
    /Renamed pre-event: Sydney workshop starts 15 September 2026 at 10:00 am at Session room, 1 Preview Street with Communication plan verifier\./u,
  );
  assert.equal(
    await overrideOccurrenceCommunication(
      {
        eventOccurrenceId,
        logicalId: inherited.logicalId,
        subject: "Sydney reminder: {{event.title}}",
        textBody: inherited.textBody,
        offsetAmount: -2,
        offsetUnit: "hour",
      },
      actor,
    ),
    "saved",
  );
  const overriddenWorkspace = await findAdminCommunicationWorkspace({
    kind: "event_occurrence",
    eventOccurrenceId,
  });
  assert.ok(overriddenWorkspace);
  const overridden = overriddenWorkspace.items[0];
  assert.ok(overridden);
  assert.equal(overridden.revision, 2);
  assert.equal(overridden.overrideState, "overridden");
  assert.equal(
    await resetOccurrenceCommunication(
      { eventOccurrenceId, logicalId: inherited.logicalId },
      actor,
    ),
    "saved",
  );
  const resetWorkspace = await findAdminCommunicationWorkspace({
    kind: "event_occurrence",
    eventOccurrenceId,
  });
  assert.ok(resetWorkspace);
  const reset = resetWorkspace.items[0];
  assert.ok(reset);
  assert.equal(reset.revision, 3);
  assert.equal(reset.overrideState, "inherited");
  assert.equal(reset.offsetAmount, -1);

  const revisions = await database
    .selectFrom("event_occurrence_communication_revision")
    .select(["revision", "active", "overrideState"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("logicalId", "=", inherited.logicalId)
    .orderBy("revision")
    .execute();
  assert.deepEqual(revisions, [
    { revision: 1, active: false, overrideState: "inherited" },
    { revision: 2, active: false, overrideState: "overridden" },
    { revision: 3, active: true, overrideState: "inherited" },
  ]);

  const recipientId = `verify_communication_recipient_${suffix}`;
  const registrationId = `verify_communication_registration_${suffix}`;
  const participationId = `verify_communication_participation_${suffix}`;
  await database
    .insertInto("user")
    .values({
      id: recipientId,
      name: "Taylor Participant",
      email: `communication-participant-${suffix}@example.com`,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      phone: "+61 400 000 001",
      currentRegionId: null,
      profileData: {},
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_registration")
    .values({
      id: registrationId,
      eventOccurrenceId,
      userId: recipientId,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: "Taylor Participant",
      emailSnapshot: `communication-participant-${suffix}@example.com`,
      source: "ordinary",
      eligibilitySource: "unrestricted",
      status: "selected",
      coordinatorPriority: null,
      submittedAt: now,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: now,
      finalDecidedByUserId: actor.id,
      lockedInAt: now,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: participationId,
      eventOccurrenceId,
      userId: recipientId,
      registrationId,
      mode: "registered",
      nameSnapshot: "Taylor Participant",
      emailSnapshot: `communication-participant-${suffix}@example.com`,
      detailsSubmittedAt: null,
      joinDisclosedAt: null,
      checkedInAt: null,
      createdAt: now,
    })
    .execute();
  await database
    .updateTable("event_occurrence")
    .set({ status: "published", publishedAt: now, confirmedCount: 1 })
    .where("id", "=", eventOccurrenceId)
    .execute();
  await database.transaction().execute(async (transaction) => {
    await refreshEventCommunicationSchedules(
      transaction,
      eventOccurrenceId,
      new Date("2026-09-01T00:00:00.000Z"),
    );
  });
  const initialSchedules = await database
    .selectFrom("event_communication_schedule")
    .select(["trigger", "revision", "status", "dueAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .orderBy("trigger")
    .execute();
  assert.deepEqual(
    initialSchedules.map((schedule) => ({
      ...schedule,
      dueAt: schedule.dueAt.toISOString(),
    })),
    [
      {
        trigger: "event_end",
        revision: 1,
        status: "pending",
        dueAt: "2026-09-15T07:00:00.000Z",
      },
      {
        trigger: "event_start",
        revision: 1,
        status: "pending",
        dueAt: "2026-09-13T23:00:00.000Z",
      },
      {
        trigger: "session_start",
        revision: 1,
        status: "pending",
        dueAt: "2026-09-14T23:30:00.000Z",
      },
    ],
  );

  await database
    .updateTable("event_occurrence")
    .set({
      startsAt: new Date("2026-09-15T23:00:00.000Z"),
      endsAt: new Date("2026-09-16T07:00:00.000Z"),
      localStartsAt: "2026-09-16T09:00:00",
      localEndsAt: "2026-09-16T17:00:00",
    })
    .where("id", "=", eventOccurrenceId)
    .execute();
  await database
    .updateTable("event_session")
    .set({
      startsAt: new Date("2026-09-16T00:00:00.000Z"),
      endsAt: new Date("2026-09-16T02:30:00.000Z"),
      localStartsAt: "2026-09-16T10:00:00",
      localEndsAt: "2026-09-16T12:30:00",
    })
    .where("id", "=", eventSessionId)
    .execute();
  await database.transaction().execute(async (transaction) => {
    await refreshEventCommunicationSchedules(
      transaction,
      eventOccurrenceId,
      new Date("2026-09-02T00:00:00.000Z"),
    );
  });
  const rescheduled = await database
    .selectFrom("event_communication_schedule")
    .select(["trigger", "revision", "status", "dueAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .orderBy("trigger")
    .orderBy("revision")
    .execute();
  assert.deepEqual(
    rescheduled.map((schedule) => ({
      trigger: schedule.trigger,
      revision: schedule.revision,
      status: schedule.status,
      dueAt: schedule.dueAt.toISOString(),
    })),
    [
      {
        trigger: "event_end",
        revision: 1,
        status: "superseded",
        dueAt: "2026-09-15T07:00:00.000Z",
      },
      {
        trigger: "event_end",
        revision: 2,
        status: "pending",
        dueAt: "2026-09-16T07:00:00.000Z",
      },
      {
        trigger: "event_start",
        revision: 1,
        status: "superseded",
        dueAt: "2026-09-13T23:00:00.000Z",
      },
      {
        trigger: "event_start",
        revision: 2,
        status: "pending",
        dueAt: "2026-09-14T23:00:00.000Z",
      },
      {
        trigger: "session_start",
        revision: 1,
        status: "superseded",
        dueAt: "2026-09-14T23:30:00.000Z",
      },
      {
        trigger: "session_start",
        revision: 2,
        status: "pending",
        dueAt: "2026-09-15T23:30:00.000Z",
      },
    ],
  );
  assert.deepEqual(
    await processNextEventCommunicationSchedule(
      new Date("2026-09-14T22:59:59.000Z"),
    ),
    { status: "no-work" },
  );
  const scheduledOutcome = await processNextEventCommunicationSchedule(
    new Date("2026-09-14T23:00:00.000Z"),
  );
  assert.equal(scheduledOutcome.status, "completed");
  assert.equal(scheduledOutcome.recipientCount, 1);
  assert.deepEqual(
    await processNextEventCommunicationSchedule(
      new Date("2026-09-14T23:00:00.000Z"),
    ),
    { status: "no-work" },
  );
  assert.equal(
    (
      await processNextEventCommunicationSchedule(
        new Date("2026-09-16T07:00:00.000Z"),
      )
    ).status,
    "completed",
  );
  assert.equal(
    (
      await processNextEventCommunicationSchedule(
        new Date("2026-09-16T07:00:00.000Z"),
      )
    ).status,
    "completed",
  );
  assert.deepEqual(
    await processNextEventCommunicationSchedule(
      new Date("2026-09-16T07:00:00.000Z"),
    ),
    { status: "no-work" },
  );

  const selectedWorkspace = await findAdminCommunicationWorkspace({
    kind: "event_occurrence",
    eventOccurrenceId,
  });
  const selectedCommunication = selectedWorkspace?.items.find(
    (item) => item.trigger === "registration_selected",
  );
  assert.ok(selectedCommunication);
  await database.transaction().execute(async (transaction) => {
    assert.equal(
      await enqueueRegistrationSelectedEventCommunications(transaction, {
        eventOccurrenceId,
        eventRegistrationId: registrationId,
        triggerEventId: `verify_selected_transition_${suffix}`,
        createdAt: new Date("2026-09-03T00:00:00.000Z"),
      }),
      1,
    );
    await enqueueRegistrationSelectedEventCommunications(transaction, {
      eventOccurrenceId,
      eventRegistrationId: registrationId,
      triggerEventId: `verify_selected_transition_${suffix}`,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
  });
  assert.equal(
    await overrideOccurrenceCommunication(
      {
        eventOccurrenceId,
        logicalId: selectedCommunication.logicalId,
        subject: "Changed after enqueue: {{event.title}}",
        textBody: selectedCommunication.textBody,
        offsetAmount: 0,
        offsetUnit: "minute",
      },
      actor,
    ),
    "saved",
  );
  await database.transaction().execute(async (transaction) => {
    assert.equal(
      await enqueueRegistrationSubmittedEventCommunications(transaction, {
        eventOccurrenceId,
        eventRegistrationId: registrationId,
        triggerEventId: `verify_submitted_transition_${suffix}`,
        createdAt: new Date("2026-09-03T00:00:00.000Z"),
      }),
      1,
    );
    assert.equal(
      await ensureEventSectionReleased(transaction, {
        eventParticipationId: participationId,
        eventTemplateVersionSectionId: eventSectionId,
        calculatedReleaseAt: now,
        now,
      }),
      true,
    );
    const completedAt = new Date("2026-09-16T07:01:00.000Z");
    await transaction
      .updateTable("event_participation")
      .set({ completedAt })
      .where("id", "=", participationId)
      .executeTakeFirstOrThrow();
    assert.equal(
      await enqueueEventParticipationCommunications(transaction, {
        eventParticipationId: participationId,
        triggerEventId: `verify_event_completed_${suffix}`,
        trigger: "event_completed",
        createdAt: completedAt,
      }),
      1,
    );
  });
  const offeringNotifications = await database
    .selectFrom("notification")
    .select(["id", "deduplicationKey", "subjectTemplateSnapshot", "payload"])
    .where("recipientUserId", "=", recipientId)
    .where("templateKey", "=", "offering_event")
    .orderBy("createdAt")
    .execute();
  assert.equal(offeringNotifications.length, 7);
  const scheduledNotifications = offeringNotifications.filter((notification) =>
    notification.deduplicationKey.startsWith("event_communication_schedule_"),
  );
  const selectedNotification = offeringNotifications.find((notification) =>
    notification.deduplicationKey.includes(
      `verify_selected_transition_${suffix}`,
    ),
  );
  assert.equal(scheduledNotifications.length, 3);
  assert.ok(selectedNotification);
  assert.equal(
    selectedNotification.subjectTemplateSnapshot,
    "Confirmed: {{event.title}}",
  );
  for (const notification of offeringNotifications)
    assert.deepEqual(await deliverNotification(notification.id), {
      status: "delivered",
    });
  const captures = await database
    .selectFrom("email_delivery_capture")
    .select(["subject", "textBody"])
    .where(
      "recipientEmail",
      "=",
      `communication-participant-${suffix}@example.com`,
    )
    .orderBy("createdAt")
    .execute();
  assert.deepEqual(
    new Set(captures.map((capture) => capture.subject)),
    new Set([
      "Your event: Communication event - Sydney",
      "Confirmed: Communication event - Sydney",
      "Submitted: Communication event - Sydney",
      "Event ended: Communication event - Sydney",
      "Session: Sydney workshop",
      "Released: Renamed pre-event",
      "Completed: Communication event - Sydney",
    ]),
  );
  assert.ok(
    captures.some(
      (capture) =>
        capture.textBody.includes("Taylor") &&
        capture.textBody.includes("Selected") &&
        capture.textBody.includes("/my-events/"),
    ),
  );
  const deliveredSelected = await database
    .selectFrom("notification")
    .select(["payload", "renderedSubject", "renderedTextBody"])
    .where("id", "=", selectedNotification.id)
    .executeTakeFirstOrThrow();
  assert.equal(
    deliveredSelected.renderedSubject,
    "Confirmed: Communication event - Sydney",
  );
  assert.match(deliveredSelected.renderedTextBody ?? "", /Taylor/u);
  assert.deepEqual(deliveredSelected.payload, {
    version: 1,
    kind: "offering_event",
    eventOccurrenceId,
    eventOccurrenceCommunicationRevisionId: selectedCommunication.id,
    trigger: "registration_selected",
    audience: "affected_learner",
    eventRegistrationId: registrationId,
    eventParticipationId: participationId,
    eventTemplateVersionSectionId: null,
  });
  await assert.rejects(
    database
      .updateTable("event_template_version_communication")
      .set({ label: "Direct mutation" })
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute(),
    /immutable/iu,
  );

  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("actorUserId", "=", actor.id)
    .execute();
  const communicationAuditActions = auditActions.filter((event) =>
    event.action.startsWith("communication_plan."),
  );
  assert.deepEqual(
    new Set(communicationAuditActions.map((event) => event.action)),
    new Set([
      "communication_plan.created",
      "communication_plan.overridden",
      "communication_plan.reset",
    ]),
  );

  console.log(
    "Verified every authorable Course/Event communication trigger, version-pinned plans, reschedule supersession, deduplication, delivery suppression and exact snapshots",
  );
} finally {
  await destroyDatabase();
}
