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
        "Hello {{user.firstName}},\n\n{{event.title}} begins {{event.startsAt}}.",
    }),
    "saved",
  );
  assert.equal(await publishAdminEmailVersion(eventEmail, actor), "published");

  const courseId = `verify_communication_course_${suffix}`;
  const courseVersionId = `verify_communication_course_version_${suffix}`;
  const courseSectionId = `verify_communication_course_section_${suffix}`;
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
    await saveCourseCommunicationPlan(
      {
        courseVersionId,
        label: "Incomplete course reminder",
        emailDesignVersionId: courseEmail.versionId,
        sectionId: courseSectionId,
        sessionDefinitionId: null,
        audience: "active_enrollees",
        trigger: "course_incomplete",
        offsetAmount: 7,
        offsetUnit: "day",
        subjectOverride: null,
        textBodyOverride: null,
      },
      actor,
    ),
    "saved",
  );
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
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        sections: [
          {
            id: courseSectionId,
            title: "Renamed course section",
            description: "",
            items: [],
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
  assert.equal(courseWorkspace.items.length, 1);
  const courseItem = courseWorkspace.items[0];
  assert.ok(courseItem);
  assert.equal(courseItem.sectionId, courseSectionId);
  const coursePreview = await previewOfferingCommunication(
    { kind: "course", courseVersionId },
    courseItem.id,
  );
  assert.equal(coursePreview?.subject, "Continue Communication course");
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

  const eventTemplateId = `verify_communication_event_template_${suffix}`;
  const eventTemplateVersionId = `verify_communication_event_version_${suffix}`;
  const eventSectionId = `verify_communication_event_section_${suffix}`;
  const eventSessionItemId = `verify_communication_event_item_${suffix}`;
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
    await saveEventTemplateCommunicationPlan(
      {
        eventTemplateVersionId,
        label: "Event starts tomorrow",
        emailDesignVersionId: eventEmail.versionId,
        sectionId: eventSectionId,
        sessionDefinitionId: eventSessionDefinitionId,
        audience: "confirmed_participants",
        trigger: "event_start",
        offsetAmount: -1,
        offsetUnit: "day",
        subjectOverride: "Your event: {{event.title}}",
        textBodyOverride: null,
      },
      actor,
    ),
    "saved",
  );
  assert.equal(
    await saveAdminEventTemplateDraft(
      {
        eventTemplateId,
        eventTemplateVersionId,
        title: "Communication event",
        summary: "Communication event summary",
        description: "Communication event description",
        hasCompletionCertificate: false,
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
    .select(["sectionId", "sessionDefinitionId"])
    .where("eventTemplateVersionId", "=", eventTemplateVersionId)
    .executeTakeFirstOrThrow();
  assert.equal(eventPlanAfterDraftSave.sectionId, eventSectionId);
  const recreatedSession = await database
    .selectFrom("event_template_version_item")
    .select("sessionDefinitionId")
    .where("id", "=", eventSessionItemId)
    .executeTakeFirstOrThrow();
  assert.equal(
    eventPlanAfterDraftSave.sessionDefinitionId,
    recreatedSession.sessionDefinitionId,
  );
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
        venueName: "Learning Centre",
        venueAddress: "Sydney",
        virtualJoinUrl: null,
        publishedAt: null,
        createdByUserId: actor.id,
        createdAt: now,
        updatedAt: now,
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
    inherited.id,
  );
  assert.equal(
    occurrencePreview?.subject,
    "Your event: Communication event - Sydney",
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
    .orderBy("revision")
    .execute();
  assert.deepEqual(revisions, [
    { revision: 1, active: false, overrideState: "inherited" },
    { revision: 2, active: false, overrideState: "overridden" },
    { revision: 3, active: true, overrideState: "inherited" },
  ]);
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
    "Verified version-pinned course and event communication plans, published-parent immutability, occurrence materialization, revisioned overrides and resets",
  );
} finally {
  await destroyDatabase();
}
