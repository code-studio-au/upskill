import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AdminSurveyDraft } from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const user: AuthenticatedUser = {
  id: "verify_onboarding_user",
  name: "Onboarding Verifier",
  email: "onboarding-verifier@example.com",
  emailVerified: true,
};
const transferUser: AuthenticatedUser = {
  id: "verify_onboarding_transfer_user",
  name: "Onboarding Transfer Verifier",
  email: "onboarding-transfer-verifier@example.com",
  emailVerified: true,
};
const regionId = "verify_onboarding_region";
const otherRegionId = "verify_onboarding_region_other";
const regionGroupId = "verify_onboarding_region_group";
const otherRegionGroupId = "verify_onboarding_region_group_other";
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
let surveyId: string | undefined;

async function verifySmsContact(
  assignmentId: string,
  recipient: AuthenticatedUser = user,
): Promise<{ complete: boolean | undefined }> {
  const { requestOnboardingContactVerification, verifyOnboardingContactCode } =
    await import("#/server/onboarding/onboarding-contact-verification.server");
  const request = await requestOnboardingContactVerification(
    { assignmentId, channel: "sms" },
    recipient,
  );
  assert.equal(request.status, "sent");
  const challenge = await database
    .selectFrom("contact_verification_challenge as challenge")
    .innerJoin(
      "contact_verification_sms_capture as capture",
      "capture.challengeId",
      "challenge.id",
    )
    .select(["challenge.reference", "capture.message"])
    .where("challenge.reference", "=", request.challengeReference)
    .executeTakeFirstOrThrow();
  const code = challenge.message.match(/\b\d{6}\b/u)?.[0];
  assert.ok(code);
  assert.deepEqual(
    await verifyOnboardingContactCode(
      {
        assignmentId,
        challengeReference: challenge.reference,
        code: code === "000000" ? "999999" : "000000",
      },
      recipient,
    ),
    { status: "invalid" },
  );
  const result = await verifyOnboardingContactCode(
    { assignmentId, challengeReference: challenge.reference, code },
    recipient,
  );
  assert.equal(result.status, "verified");
  return { complete: result.complete };
}

async function cleanup(): Promise<void> {
  const userIds = [user.id, transferUser.id];
  const definitionVersions = await database
    .selectFrom("onboarding_definition_version")
    .select("id")
    .where("definitionId", "=", "onboarding_definition_default")
    .execute();
  const definitionVersionIds = definitionVersions.map((version) => version.id);
  const assignments = await database
    .selectFrom("onboarding_assignment")
    .select("id")
    .where((expression) =>
      expression.or([
        expression("userId", "in", userIds),
        ...(definitionVersionIds.length > 0
          ? [expression("definitionVersionId", "in", definitionVersionIds)]
          : []),
      ]),
    )
    .execute();
  const assignmentIds = assignments.map((assignment) => assignment.id);
  if (assignmentIds.length > 0) {
    await database
      .deleteFrom("onboarding_response")
      .where("assignmentId", "in", assignmentIds)
      .execute();
    await database
      .deleteFrom("onboarding_assignment")
      .where("id", "in", assignmentIds)
      .execute();
  }
  const notifications = await database
    .selectFrom("notification")
    .select("id")
    .where("recipientUserId", "in", userIds)
    .execute();
  const notificationIds = notifications.map((notification) => notification.id);
  if (notificationIds.length > 0) {
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", notificationIds)
      .execute();
    await database
      .deleteFrom("notification_delivery_attempt")
      .where("notificationId", "in", notificationIds)
      .execute();
    await database
      .deleteFrom("email_delivery_capture")
      .where("notificationId", "in", notificationIds)
      .execute();
    await database
      .deleteFrom("notification")
      .where("id", "in", notificationIds)
      .execute();
  }
  await database
    .deleteFrom("sms_delivery")
    .where("recipientUserId", "in", userIds)
    .execute();
  await database
    .deleteFrom("onboarding_definition")
    .where("id", "=", "onboarding_definition_default")
    .execute();
  if (surveyId) {
    await database
      .deleteFrom("learning_activity_version")
      .where("activityId", "=", surveyId)
      .execute();
    await database
      .deleteFrom("learning_activity")
      .where("id", "=", surveyId)
      .execute();
  }
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", userIds)
      .execute();
    await transaction
      .deleteFrom("audit_event")
      .where((expression) =>
        expression.or([
          expression("actorUserId", "in", userIds),
          expression("subjectId", "in", userIds),
        ]),
      )
      .execute();
  });
  await database.deleteFrom("user").where("id", "in", userIds).execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "in", [
      regionId,
      otherRegionId,
      regionGroupId,
      otherRegionGroupId,
    ])
    .execute();
}

try {
  const existingDefinition = await database
    .selectFrom("onboarding_definition")
    .select("id")
    .where("id", "=", "onboarding_definition_default")
    .executeTakeFirst();
  if (existingDefinition)
    throw new Error(
      "Onboarding verification requires a disposable database without an existing configuration.",
    );
  await cleanup();
  await database
    .insertInto("coordination_region")
    .values([
      {
        id: regionGroupId,
        name: "Verification group",
        code: "VERIFY-GROUP",
        kind: "group",
        parentId: null,
        status: "active",
        createdAt: new Date(),
      },
      {
        id: otherRegionGroupId,
        name: "Other verification group",
        code: "VERIFY-GROUP-OTHER",
        kind: "group",
        parentId: null,
        status: "active",
        createdAt: new Date(),
      },
      {
        id: regionId,
        name: "Verification region",
        code: "VERIFY-ONBOARDING",
        kind: "operational",
        parentId: regionGroupId,
        status: "active",
        createdAt: new Date(),
      },
      {
        id: otherRegionId,
        name: "Other verification region",
        code: "VERIFY-ONBOARDING-OTHER",
        kind: "operational",
        parentId: otherRegionGroupId,
        status: "active",
        createdAt: new Date(),
      },
    ])
    .execute();
  await database
    .insertInto("user")
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .execute();
  const { createAdminSurvey, publishAdminSurveyVersion, saveAdminSurveyDraft } =
    await import("#/server/admin/admin-survey.server");
  const created = await createAdminSurvey(
    "Verified onboarding",
    "system",
    user,
  );
  surveyId = created.surveyId;
  const draft: AdminSurveyDraft = {
    surveyId,
    versionId: created.versionId,
    title: "Verified onboarding",
    description: "",
    sections: [
      {
        id: "onboarding_profile",
        title: "Your profile",
        description: "",
        items: [
          {
            id: "onboarding_name",
            kind: "short_text",
            prompt: "Full name",
            required: true,
            maximumLength: 160,
            format: "plain",
            profileField: "name",
          },
          {
            id: "onboarding_phone",
            kind: "short_text",
            prompt: "Phone number",
            required: true,
            maximumLength: 40,
            format: "phone",
            profileField: "phone",
          },
          {
            id: "onboarding_email_enabled",
            kind: "checkbox",
            prompt: "Enable email access codes",
            required: false,
            profileField: "emailEnabled",
          },
          {
            id: "onboarding_sms_enabled",
            kind: "checkbox",
            prompt: "Enable SMS access codes",
            required: false,
            profileField: "smsEnabled",
          },
          {
            id: "onboarding_works_in_region",
            kind: "single_choice",
            prompt: "Do you work in a region?",
            required: true,
            options: [
              {
                id: "onboarding_works_in_region_yes",
                label: "Yes",
                nextSectionId: "onboarding_region_group",
              },
              {
                id: "onboarding_works_in_region_no",
                label: "No",
                nextSectionId: "onboarding_finish",
              },
            ],
          },
        ],
      },
      {
        id: "onboarding_region_group",
        title: "Region group",
        description: "",
        items: [
          {
            id: "onboarding_region_group",
            kind: "dropdown",
            optionSource: "coordination_region_groups",
            prompt: "Region group",
            required: true,
            options: [],
          },
        ],
      },
      {
        id: "onboarding_operational_region",
        title: "Operational region",
        description: "",
        items: [
          {
            id: "onboarding_region",
            kind: "dropdown",
            optionSource: "coordination_operational_regions",
            prompt: "Operational region",
            required: true,
            options: [],
          },
        ],
      },
      {
        id: "onboarding_finish",
        title: "Finish",
        description: "",
        items: [
          {
            id: "onboarding_finish_information",
            kind: "instruction",
            title: "Profile ready",
            body: "Continue to finish onboarding.",
          },
        ],
      },
    ],
  };
  const unsafeDraft = structuredClone(draft);
  const unsafeBranchQuestion = unsafeDraft.sections[0]?.items.find(
    (item) => item.id === "onboarding_works_in_region",
  );
  if (!unsafeBranchQuestion || unsafeBranchQuestion.kind !== "single_choice")
    throw new Error("Expected onboarding branch question");
  const unsafeYesOption = unsafeBranchQuestion.options[0];
  if (!unsafeYesOption) throw new Error("Expected onboarding yes option");
  unsafeBranchQuestion.options[0] = {
    ...unsafeYesOption,
    nextSectionId: "onboarding_operational_region",
  };
  const invalidProfileDraft = structuredClone(draft);
  const invalidPhoneQuestion = invalidProfileDraft.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === "onboarding_phone");
  if (!invalidPhoneQuestion || invalidPhoneQuestion.kind !== "short_text")
    throw new Error("Expected onboarding mobile phone question");
  invalidPhoneQuestion.required = false;
  assert.equal(
    await saveAdminSurveyDraft(invalidProfileDraft, user),
    "invalid",
  );
  assert.equal(await saveAdminSurveyDraft(unsafeDraft, user), "saved");
  assert.equal(
    await publishAdminSurveyVersion(surveyId, created.versionId, user),
    "invalid",
  );
  assert.equal(await saveAdminSurveyDraft(draft, user), "saved");
  assert.equal(
    await publishAdminSurveyVersion(surveyId, created.versionId, user),
    "published",
  );
  const { activateOnboardingConfiguration, findAdminOnboarding } =
    await import("#/server/onboarding/admin-onboarding.server");
  const activation = await activateOnboardingConfiguration(
    {
      surveyVersionId: created.versionId,
      privacyNotice: "Verification privacy notice",
      privacyNoticeVersion: "1",
      contactVerificationRequired: false,
    },
    user,
  );
  assert.equal(activation.status, "activated");
  const automaticMappings = await database
    .selectFrom("onboarding_definition_version")
    .select("profileMappings")
    .where("id", "=", activation.configurationId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    (automaticMappings.profileMappings as Array<{ destination: string }>)
      .map((mapping) => mapping.destination)
      .sort(),
    ["currentRegionId", "emailEnabled", "name", "phone", "smsEnabled"],
  );
  const { findLearnerOnboarding, saveLearnerOnboardingStep } =
    await import("#/server/onboarding/learner-onboarding.server");
  const onboarding = await findLearnerOnboarding(user);
  assert.equal(typeof onboarding, "object");
  if (typeof onboarding === "string") throw new Error("Expected assignment");
  const outOfSequence = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_phone",
    "+61 400 000 000",
    user,
  );
  assert.equal(outOfSequence.status, "invalid");
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_name",
        "Updated Learner",
        user,
      )
    ).status,
    "advanced",
  );
  const secondActivation = await activateOnboardingConfiguration(
    {
      surveyVersionId: created.versionId,
      privacyNotice: "Updated verification privacy notice",
      privacyNoticeVersion: "2",
      contactVerificationRequired: true,
    },
    user,
  );
  assert.equal(secondActivation.status, "activated");
  const adminOnboarding = await findAdminOnboarding();
  assert.equal(adminOnboarding.active?.id, secondActivation.configurationId);
  assert.deepEqual(
    adminOnboarding.versions.map((configuration) => configuration.id),
    [secondActivation.configurationId, activation.configurationId],
  );
  assert.equal(
    adminOnboarding.versions.find(
      (configuration) => configuration.id === activation.configurationId,
    )?.privacyNotice,
    "Verification privacy notice",
  );
  assert.ok(adminOnboarding.versions[0]?.mappingDetails.length);
  assert.equal(
    (
      await database
        .selectFrom("onboarding_assignment")
        .select("definitionVersionId")
        .where("id", "=", onboarding.assignmentId)
        .executeTakeFirstOrThrow()
    ).definitionVersionId,
    activation.configurationId,
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_phone",
        "+61 400 000 000",
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_email_enabled",
        true,
        user,
      )
    ).status,
    "advanced",
  );
  const smsCheckpoint = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_sms_enabled",
    true,
    user,
  );
  assert.equal(smsCheckpoint.status, "advanced");
  assert.equal(smsCheckpoint.verificationChannel, "sms");
  const pendingCheckpoint = await findLearnerOnboarding(user);
  assert.equal(typeof pendingCheckpoint, "object");
  if (typeof pendingCheckpoint === "string")
    throw new Error("Expected in-progress onboarding");
  assert.equal(pendingCheckpoint.submittedAt, null);
  assert.deepEqual(pendingCheckpoint.verification.checkpoint, {
    channel: "sms",
    phoneQuestionId: "onboarding_phone",
  });
  const { skipOnboardingContactVerification } =
    await import("#/server/onboarding/onboarding-contact-verification.server");
  assert.deepEqual(
    await skipOnboardingContactVerification(onboarding.assignmentId, user),
    { status: "skipped", complete: false },
  );
  const resumedOnboarding = await findLearnerOnboarding(user);
  assert.equal(typeof resumedOnboarding, "object");
  if (typeof resumedOnboarding === "string")
    throw new Error("Expected resumed onboarding");
  assert.equal(resumedOnboarding.verification.checkpoint, null);
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_works_in_region",
        "onboarding_works_in_region_yes",
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_region_group",
        regionGroupId,
        user,
      )
    ).status,
    "advanced",
  );
  const wrongGroup = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_region",
    otherRegionId,
    user,
  );
  assert.equal(wrongGroup.status, "invalid");
  const regionCompleted = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_region",
    regionId,
    user,
  );
  assert.equal(regionCompleted.status, "advanced");
  const completed = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_finish_information",
    undefined,
    user,
  );
  assert.equal(completed.status, "submitted");
  const repeatedCompletion = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_region",
    regionId,
    user,
  );
  assert.equal(repeatedCompletion.status, "submitted");
  assert.equal(repeatedCompletion.progress.percent, 100);
  assert.ok(repeatedCompletion.progress.completedAt);
  const updated = await database
    .selectFrom("user")
    .select([
      "name",
      "phone",
      "currentRegionId",
      "emailEnabled",
      "smsEnabled",
      "smsVerifiedAt",
    ])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(updated, {
    name: "Updated Learner",
    phone: "+61400000000",
    currentRegionId: regionId,
    emailEnabled: true,
    smsEnabled: true,
    smsVerifiedAt: null,
  });
  assert.equal(await findLearnerOnboarding(user), "complete");
  const { requireAdminReOnboarding } =
    await import("#/server/admin/admin-learner.server");
  assert.equal(await requireAdminReOnboarding(user.id, user), "assigned");
  const reassigned = await findLearnerOnboarding(user);
  assert.equal(typeof reassigned, "object");
  if (typeof reassigned === "string")
    throw new Error("Expected administrator re-onboarding assignment");
  assert.notEqual(reassigned.assignmentId, onboarding.assignmentId);
  assert.equal(
    await requireAdminReOnboarding(user.id, user),
    "onboarding-already-required",
  );
  const assignmentHistory = await database
    .selectFrom("onboarding_assignment")
    .select(["id", "definitionVersionId", "status", "source"])
    .where("userId", "=", user.id)
    .orderBy("assignedAt")
    .execute();
  assert.deepEqual(assignmentHistory, [
    {
      id: onboarding.assignmentId,
      definitionVersionId: activation.configurationId,
      status: "completed",
      source: "automatic",
    },
    {
      id: reassigned.assignmentId,
      definitionVersionId: secondActivation.configurationId,
      status: "assigned",
      source: "administrator",
    },
  ]);
  await database
    .updateTable("user")
    .set({ smsVerifiedAt: null })
    .where("id", "=", user.id)
    .execute();
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_name",
        "Updated Learner",
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_phone",
        "+61 400 000 000",
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_email_enabled",
        undefined,
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await database
        .selectFrom("user")
        .select("emailEnabled")
        .where("id", "=", user.id)
        .executeTakeFirstOrThrow()
    ).emailEnabled,
    false,
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_email_enabled",
        true,
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_sms_enabled",
        undefined,
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    (
      await database
        .selectFrom("user")
        .select("smsEnabled")
        .where("id", "=", user.id)
        .executeTakeFirstOrThrow()
    ).smsEnabled,
    false,
  );
  const requiredSmsCheckpoint = await saveLearnerOnboardingStep(
    reassigned.assignmentId,
    "onboarding_sms_enabled",
    true,
    user,
  );
  assert.equal(requiredSmsCheckpoint.status, "advanced");
  assert.equal(requiredSmsCheckpoint.verificationChannel, "sms");
  const blockedRegion = await saveLearnerOnboardingStep(
    reassigned.assignmentId,
    "onboarding_works_in_region",
    "onboarding_works_in_region_no",
    user,
  );
  assert.deepEqual(blockedRegion, {
    status: "invalid",
    message: "Verify your mobile number before continuing onboarding.",
  });
  assert.equal(
    (await verifySmsContact(reassigned.assignmentId)).complete,
    false,
  );
  const skippedRegion = await saveLearnerOnboardingStep(
    reassigned.assignmentId,
    "onboarding_works_in_region",
    "onboarding_works_in_region_no",
    user,
  );
  assert.equal(skippedRegion.status, "advanced");
  assert.equal(
    skippedRegion.progress.currentItemId,
    "onboarding_finish_information",
  );
  assert.equal(skippedRegion.progress.totalItems, 6);
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        reassigned.assignmentId,
        "onboarding_finish_information",
        undefined,
        user,
      )
    ).status,
    "submitted",
  );
  assert.deepEqual(
    await skipOnboardingContactVerification(reassigned.assignmentId, user),
    { status: "unavailable" },
  );
  const transferNow = new Date();
  const transferAssignmentId = "verify_onboarding_transfer_assignment";
  await database
    .insertInto("user")
    .values({
      id: transferUser.id,
      name: transferUser.name,
      email: transferUser.email,
      emailVerified: true,
      emailEnabled: true,
      emailVerifiedAt: transferNow,
      image: null,
      stripeCustomerId: null,
      phone: "+61400000000",
      smsEnabled: true,
      smsVerifiedAt: null,
    })
    .execute();
  await database
    .insertInto("onboarding_assignment")
    .values({
      id: transferAssignmentId,
      userId: transferUser.id,
      definitionVersionId: secondActivation.configurationId,
      status: "in_progress",
      source: "automatic",
      assignedAt: transferNow,
      startedAt: transferNow,
      completedAt: null,
      supersededAt: null,
      verificationSkippedAt: null,
    })
    .execute();
  await database
    .insertInto("onboarding_response")
    .values({
      id: "verify_onboarding_transfer_response",
      assignmentId: transferAssignmentId,
      surveyVersionId: created.versionId,
      answers: {},
      visitedItemIds: [],
      currentItemId: null,
      startedAt: transferNow,
      updatedAt: transferNow,
      submittedAt: transferNow,
      redactedAt: null,
    })
    .execute();
  assert.equal(
    (await verifySmsContact(transferAssignmentId, transferUser)).complete,
    true,
  );
  const verifiedOwners = await database
    .selectFrom("user")
    .select(["id", "smsVerifiedAt"])
    .where("id", "in", [user.id, transferUser.id])
    .orderBy("id")
    .execute();
  assert.equal(
    verifiedOwners.find((recipient) => recipient.id === user.id)?.smsVerifiedAt,
    null,
  );
  assert.ok(
    verifiedOwners.find((recipient) => recipient.id === transferUser.id)
      ?.smsVerifiedAt,
  );
  const phoneClaims = await database
    .selectFrom("phone_verification_claim")
    .select(["userId", "releasedAt", "releaseReason"])
    .where("phone", "=", "+61400000000")
    .where("userId", "in", [user.id, transferUser.id])
    .orderBy("claimedAt")
    .execute();
  assert.ok(phoneClaims.length >= 2);
  assert.equal(phoneClaims.at(-2)?.userId, user.id);
  assert.equal(phoneClaims.at(-2)?.releaseReason, "transferred");
  assert.ok(phoneClaims.at(-2)?.releasedAt);
  assert.deepEqual(phoneClaims.at(-1), {
    userId: transferUser.id,
    releasedAt: null,
    releaseReason: null,
  });
  const transferNotification = await database
    .selectFrom("notification")
    .select("id")
    .where("templateKey", "=", "phone_verification_transferred")
    .where("recipientUserId", "=", user.id)
    .executeTakeFirstOrThrow();
  const { deliverNotification } =
    await import("#/server/notifications/notification-delivery.server");
  assert.deepEqual(await deliverNotification(transferNotification.id), {
    status: "delivered",
  });
  const transferEmail = await database
    .selectFrom("email_delivery_capture")
    .select(["subject", "textBody"])
    .where("notificationId", "=", transferNotification.id)
    .executeTakeFirstOrThrow();
  assert.match(transferEmail.subject, /verified on another account/iu);
  assert.match(transferEmail.textBody, /ending in 0000/iu);
  assert.doesNotMatch(transferEmail.textBody, /Transfer Verifier/u);
  const smsDeliveries = await database
    .selectFrom("sms_delivery")
    .select(["recipientUserId", "recipientNameSnapshot"])
    .where("purpose", "=", "onboarding_contact_verification")
    .where("recipientUserId", "in", [user.id, transferUser.id])
    .orderBy("createdAt")
    .execute();
  assert.ok(
    smsDeliveries.some(
      (delivery) =>
        delivery.recipientUserId === user.id &&
        delivery.recipientNameSnapshot === "Updated Learner",
    ),
  );
  assert.ok(
    smsDeliveries.some(
      (delivery) =>
        delivery.recipientUserId === transferUser.id &&
        delivery.recipientNameSnapshot === transferUser.name,
    ),
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("currentRegionId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.currentRegionId),
    null,
  );
  console.log(
    "Verified version-pinned onboarding, profile projection, contact verification, transferable phone ownership, immutable SMS attribution and displaced-account email",
  );
} finally {
  await cleanup();
  await database.destroy();
}
