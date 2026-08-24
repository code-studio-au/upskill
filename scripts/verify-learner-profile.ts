import assert from "node:assert/strict";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import {
  findLearnerProfile,
  updateLearnerProfile,
} from "#/server/profile/learner-profile.server";
import {
  requestProfileContactVerification,
  verifyProfileContactCode,
} from "#/server/profile/profile-contact-verification.server";

const database = getDatabase();
const user: AuthenticatedUser = {
  id: "verify_learner_profile_user",
  name: "Profile Verifier",
  email: "profile-verifier@example.com",
  emailVerified: false,
};
const ids = {
  group: "verify_learner_profile_group",
  region: "verify_learner_profile_region",
  oldClaim: "verify_learner_profile_old_claim",
  oldChallenge: "verify_learner_profile_old_challenge",
};

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("sms_delivery")
    .where("recipientUserId", "=", user.id)
    .execute();
  await database
    .deleteFrom("contact_verification_challenge")
    .where("userId", "=", user.id)
    .execute();
  await database
    .deleteFrom("phone_verification_claim")
    .where("userId", "=", user.id)
    .execute();
  await database.deleteFrom("user").where("id", "=", user.id).execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "in", [ids.region, ids.group])
    .execute();
}

function verificationCode(message: string): string {
  const code = message.match(/\b\d{6}\b/u)?.[0];
  assert.ok(code);
  return code;
}

try {
  await cleanup();
  const now = new Date();
  await database
    .insertInto("coordination_region")
    .values([
      {
        id: ids.group,
        name: "Profile verification group",
        code: "PROFILE-GROUP",
        kind: "group",
        parentId: null,
        status: "active",
        createdAt: now,
      },
      {
        id: ids.region,
        name: "Profile verification region",
        code: "PROFILE-REGION",
        kind: "operational",
        parentId: ids.group,
        status: "active",
        createdAt: now,
      },
    ])
    .execute();
  await database
    .insertInto("user")
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: false,
      emailEnabled: true,
      emailVerifiedAt: null,
      phone: "+61400000001",
      smsEnabled: true,
      smsVerifiedAt: now,
      currentRegionId: null,
      image: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("contact_verification_challenge")
    .values({
      id: ids.oldChallenge,
      reference: "A".repeat(32),
      assignmentId: null,
      userId: user.id,
      purpose: "profile",
      channel: "sms",
      destinationDigest: "A".repeat(43),
      codeDigest: "B".repeat(43),
      attempts: 0,
      expiresAt: new Date(now.getTime() + 600_000),
      consumedAt: null,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("phone_verification_claim")
    .values({
      id: ids.oldClaim,
      phone: "+61400000001",
      userId: user.id,
      verificationChallengeId: ids.oldChallenge,
      claimedAt: now,
      releasedAt: null,
      releaseReason: null,
      createdAt: now,
    })
    .execute();

  assert.deepEqual(
    await updateLearnerProfile(
      {
        name: "Updated Profile Verifier",
        phone: "+61 400 000 002",
        currentRegionId: ids.region,
        emailEnabled: false,
        smsEnabled: true,
      },
      user,
    ),
    { status: "updated" },
  );
  const updated = await database
    .selectFrom("user")
    .select([
      "name",
      "phone",
      "emailEnabled",
      "smsEnabled",
      "smsVerifiedAt",
      "currentRegionId",
    ])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(updated, {
    name: "Updated Profile Verifier",
    phone: "+61400000002",
    emailEnabled: false,
    smsEnabled: true,
    smsVerifiedAt: null,
    currentRegionId: ids.region,
  });
  const released = await database
    .selectFrom("phone_verification_claim")
    .select(["releasedAt", "releaseReason"])
    .where("id", "=", ids.oldClaim)
    .executeTakeFirstOrThrow();
  assert.ok(released.releasedAt);
  assert.equal(released.releaseReason, "phone_changed");
  assert.ok(
    (
      await database
        .selectFrom("contact_verification_challenge")
        .select("consumedAt")
        .where("id", "=", ids.oldChallenge)
        .executeTakeFirstOrThrow()
    ).consumedAt,
  );

  const emailRequest = await requestProfileContactVerification("email", user);
  assert.equal(emailRequest.status, "sent");
  assert.ok("challengeReference" in emailRequest);
  const emailChallenge = await database
    .selectFrom("contact_verification_challenge as challenge")
    .innerJoin(
      "contact_verification_email_capture as capture",
      "capture.challengeId",
      "challenge.id",
    )
    .select(["challenge.reference", "capture.textBody"])
    .where("challenge.reference", "=", emailRequest.challengeReference)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await verifyProfileContactCode(
        {
          challengeReference: emailChallenge.reference,
          code: verificationCode(emailChallenge.textBody),
        },
        user,
      )
    ).status,
    "verified",
  );

  const smsRequest = await requestProfileContactVerification("sms", user);
  assert.equal(smsRequest.status, "sent");
  assert.ok("challengeReference" in smsRequest);
  const smsChallenge = await database
    .selectFrom("contact_verification_challenge as challenge")
    .innerJoin(
      "contact_verification_sms_capture as capture",
      "capture.challengeId",
      "challenge.id",
    )
    .select(["challenge.reference", "capture.message"])
    .where("challenge.reference", "=", smsRequest.challengeReference)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await verifyProfileContactCode(
        {
          challengeReference: smsChallenge.reference,
          code: verificationCode(smsChallenge.message),
        },
        user,
      )
    ).status,
    "verified",
  );
  const profile = await findLearnerProfile(user);
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.smsVerifiedAt !== null, true);
  assert.equal(profile.currentRegionId, ids.region);
  assert.deepEqual(profile.regions, [
    {
      id: ids.region,
      name: "Profile verification region",
      groupName: "Profile verification group",
      active: true,
    },
  ]);
  console.log(
    "Verified learner profile updates, phone-claim invalidation and profile email/SMS verification",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
