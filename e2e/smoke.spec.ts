import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { withPgAuditMaintenance } from "../scripts/audit-maintenance";

async function cleanupScormPackageFixture(
  database: Client,
  packageId: string,
  packageVersionId: string,
): Promise<void> {
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from outbox_event where "aggregateId" = $1`,
      [packageVersionId],
    );
    await transaction.query(`delete from audit_event where "subjectId" = $1`, [
      packageVersionId,
    ]);
    await transaction.query(`delete from scorm_package_version where id = $1`, [
      packageVersionId,
    ]);
    await transaction.query(
      `delete from learning_activity_version where id = $1`,
      [packageVersionId],
    );
    await transaction.query(`delete from learning_activity where id = $1`, [
      packageId,
    ]);
  });
}

async function cleanupLearnerScormPlayerFixture(
  database: Client,
  ids: {
    course: string;
    courseVersion: string;
    enrollment: string;
    package: string;
    packageVersion: string;
  },
): Promise<void> {
  const attempts = await database.query<{ id: string }>(
    `select id from scorm_attempt where "enrollmentId" = $1`,
    [ids.enrollment],
  );
  const attemptIds = attempts.rows.map((attempt) => attempt.id);
  await withPgAuditMaintenance(database, async (transaction) => {
    if (attemptIds.length > 0) {
      await transaction.query(
        `delete from outbox_event where "aggregateId" = any($1::text[])`,
        [attemptIds],
      );
      await transaction.query(
        `delete from audit_event where "subjectId" = any($1::text[])`,
        [attemptIds],
      );
      await transaction.query(
        `delete from scorm_attempt_session where "attemptId" = any($1::text[])`,
        [attemptIds],
      );
      await transaction.query(
        `delete from scorm_launch_token where "attemptId" = any($1::text[])`,
        [attemptIds],
      );
    }
    await transaction.query(
      `delete from outbox_event where "aggregateId" = $1`,
      [ids.enrollment],
    );
    await transaction.query(
      `delete from audit_event where "subjectId" = any($1::text[]) or metadata @> $2::jsonb`,
      [
        [ids.enrollment, ids.course, ids.courseVersion],
        JSON.stringify({ enrollmentId: ids.enrollment }),
      ],
    );
    await transaction.query(
      `delete from learning_item_progress where "enrollmentId" = $1`,
      [ids.enrollment],
    );
    await transaction.query(
      `delete from learning_progress_override where "enrollmentId" = $1`,
      [ids.enrollment],
    );
    await transaction.query(
      `delete from scorm_attempt where "enrollmentId" = $1`,
      [ids.enrollment],
    );
    await transaction.query(`delete from enrollment where id = $1`, [
      ids.enrollment,
    ]);
    await transaction.query(
      `delete from course_version_item where "courseVersionId" = $1`,
      [ids.courseVersion],
    );
    await transaction.query(
      `delete from course_version_section where "courseVersionId" = $1`,
      [ids.courseVersion],
    );
    await transaction.query(`delete from scorm_package_version where id = $1`, [
      ids.packageVersion,
    ]);
    await transaction.query(
      `delete from learning_activity_version where id = $1`,
      [ids.packageVersion],
    );
    await transaction.query(`delete from learning_activity where id = $1`, [
      ids.package,
    ]);
    await transaction.query(`delete from course_version where id = $1`, [
      ids.courseVersion,
    ]);
    await transaction.query(`delete from course where id = $1`, [ids.course]);
  });
}

async function cleanupCourseAuthoringFixture(
  database: Client,
  slug: string,
): Promise<void> {
  const course = await database.query<{ id: string }>(
    `select id from course where slug = $1`,
    [slug],
  );
  const courseId = course.rows[0]?.id;
  if (!courseId) return;
  const versions = await database.query<{ id: string }>(
    `select id from course_version where "courseId" = $1`,
    [courseId],
  );
  const versionIds = versions.rows.map((version) => version.id);
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from outbox_event where "aggregateId" = any($1::text[])`,
      [[courseId, ...versionIds]],
    );
    await transaction.query(
      `delete from audit_event where "subjectId" = any($1::text[])`,
      [[courseId, ...versionIds]],
    );
    if (versionIds.length > 0) {
      await transaction.query(
        `delete from course_version_item where "courseVersionId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from course_version_section where "courseVersionId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from course_version where id = any($1::text[])`,
        [versionIds],
      );
    }
    await transaction.query(`delete from course where id = $1`, [courseId]);
  });
}

async function cleanupEventAuthoringFixture(
  database: Client,
  title: string,
): Promise<void> {
  const template = await database.query<{ id: string }>(
    `select id from event_template where title = $1`,
    [title],
  );
  const eventTemplateId = template.rows[0]?.id;
  if (!eventTemplateId) return;
  const versions = await database.query<{ id: string }>(
    `select id from event_template_version where "eventTemplateId" = $1`,
    [eventTemplateId],
  );
  const versionIds = versions.rows.map((version) => version.id);
  const occurrences = await database.query<{ id: string }>(
    `select id from event_occurrence where "eventTemplateVersionId" = any($1::text[])`,
    [versionIds],
  );
  const occurrenceIds = occurrences.rows.map((occurrence) => occurrence.id);
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from outbox_event where "aggregateId" = any($1::text[])`,
      [[eventTemplateId, ...occurrenceIds]],
    );
    await transaction.query(
      `delete from audit_event where "subjectId" = any($1::text[])`,
      [[eventTemplateId, ...versionIds, ...occurrenceIds]],
    );
    if (occurrenceIds.length > 0) {
      const participations = await transaction.query<{ id: string }>(
        `select id from event_participation where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      const participationIds = participations.rows.map(
        (participation) => participation.id,
      );
      if (participationIds.length > 0) {
        await transaction.query(
          `delete from learning_item_progress where "eventParticipationId" = any($1::text[])`,
          [participationIds],
        );
        await transaction.query(
          `delete from survey_progress where "eventParticipationId" = any($1::text[])`,
          [participationIds],
        );
        await transaction.query(
          `delete from survey_response where "eventParticipationId" = any($1::text[])`,
          [participationIds],
        );
        await transaction.query(
          `delete from event_section_release where "eventParticipationId" = any($1::text[])`,
          [participationIds],
        );
        await transaction.query(
          `delete from event_attendance where "eventParticipationId" = any($1::text[])`,
          [participationIds],
        );
        await transaction.query(
          `delete from event_participation where id = any($1::text[])`,
          [participationIds],
        );
      }
      const registrations = await transaction.query<{ id: string }>(
        `select id from event_registration where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      const registrationIds = registrations.rows.map(
        (registration) => registration.id,
      );
      if (registrationIds.length > 0) {
        await transaction.query(
          `delete from event_registration_transition where "eventRegistrationId" = any($1::text[])`,
          [registrationIds],
        );
        await transaction.query(
          `delete from event_registration where id = any($1::text[])`,
          [registrationIds],
        );
      }
      await transaction.query(
        `delete from event_presenter_assignment where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      const occurrenceRegions = await transaction.query<{ id: string }>(
        `select id from event_occurrence_region where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      const occurrenceRegionIds = occurrenceRegions.rows.map(
        (region) => region.id,
      );
      if (occurrenceRegionIds.length > 0) {
        await transaction.query(
          `delete from event_coordinator_assignment where "eventOccurrenceRegionId" = any($1::text[])`,
          [occurrenceRegionIds],
        );
        await transaction.query(
          `delete from event_region_review_round where "eventOccurrenceRegionId" = any($1::text[])`,
          [occurrenceRegionIds],
        );
        await transaction.query(
          `delete from event_occurrence_region where id = any($1::text[])`,
          [occurrenceRegionIds],
        );
      }
      await transaction.query(
        `delete from event_admin_assignment where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      await transaction.query(
        `delete from event_session where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      await transaction.query(
        `delete from event_occurrence_domain where "eventOccurrenceId" = any($1::text[])`,
        [occurrenceIds],
      );
      await transaction.query(
        `delete from event_occurrence where id = any($1::text[])`,
        [occurrenceIds],
      );
    }
    if (versionIds.length > 0) {
      await transaction.query(
        `delete from event_template_version_presenter_default where "eventTemplateVersionId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from event_template_session_definition where "eventTemplateVersionId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from event_template_version_admin_default where "eventTemplateVersionId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from event_template_version where id = any($1::text[])`,
        [versionIds],
      );
    }
    await transaction.query(`delete from event_template where id = $1`, [
      eventTemplateId,
    ]);
  });
}

async function cleanupEventStaffFixture(
  database: Client,
  userId: string,
): Promise<void> {
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from audit_event where "subjectId" = $1 and action like 'event_staff.%'`,
      [userId],
    );
    await transaction.query(
      `delete from event_staff_eligibility where "userId" = $1`,
      [userId],
    );
    await transaction.query(`delete from "user" where id = $1`, [userId]);
  });
}

async function cleanupSurveyAuthoringFixture(
  database: Client,
  titles: Array<string>,
): Promise<void> {
  const surveys = await database.query<{ id: string }>(
    `select id from learning_activity where kind = 'survey' and title = any($1::text[])`,
    [titles],
  );
  const surveyIds = surveys.rows.map((survey) => survey.id);
  if (surveyIds.length === 0) return;
  const versions = await database.query<{ id: string }>(
    `select id from learning_activity_version where "activityId" = any($1::text[])`,
    [surveyIds],
  );
  const versionIds = versions.rows.map((version) => version.id);
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from outbox_event where "aggregateId" = any($1::text[])`,
      [[...surveyIds, ...versionIds]],
    );
    await transaction.query(
      `delete from audit_event where "subjectId" = any($1::text[])`,
      [[...surveyIds, ...versionIds]],
    );
    if (versionIds.length > 0) {
      await transaction.query(
        `delete from survey_version where id = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from learning_activity_version where id = any($1::text[])`,
        [versionIds],
      );
    }
    await transaction.query(
      `delete from learning_activity where id = any($1::text[])`,
      [surveyIds],
    );
  });
}

async function cleanupResourceFixture(
  database: Client,
  title: string,
  knownVersionIds: Array<string>,
): Promise<void> {
  const resources = await database.query<{ id: string }>(
    `select id from learning_activity where kind = 'resource' and title = $1`,
    [title],
  );
  const resourceIds = resources.rows.map((resource) => resource.id);
  const versions = await database.query<{ id: string }>(
    `select id from learning_activity_version where "activityId" = any($1::text[])`,
    [resourceIds],
  );
  const versionIds = [
    ...new Set([
      ...knownVersionIds,
      ...versions.rows.map((version) => version.id),
    ]),
  ];
  await withPgAuditMaintenance(database, async (transaction) => {
    if (versionIds.length > 0) {
      await transaction.query(
        `delete from outbox_event where "aggregateId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from audit_event where "subjectId" = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from learning_resource_version where id = any($1::text[])`,
        [versionIds],
      );
      await transaction.query(
        `delete from learning_activity_version where id = any($1::text[])`,
        [versionIds],
      );
    }
    await transaction.query(
      `delete from learning_activity where id = any($1::text[])`,
      [resourceIds],
    );
  });
}

async function cleanupAccessGrantFixture(
  database: Client,
  label: string,
  organizationName: string,
): Promise<void> {
  const grants = await database.query<{
    id: string;
    organizationId: string | null;
  }>(`select id, "organizationId" from access_grant where label = $1`, [label]);
  const grantIds = grants.rows.map((grant) => grant.id);
  const organizationIds = grants.rows.flatMap((grant) =>
    grant.organizationId ? [grant.organizationId] : [],
  );
  if (grantIds.length > 0) {
    await withPgAuditMaintenance(database, async (transaction) => {
      await transaction.query(
        `delete from outbox_event where "aggregateId" = any($1::text[])`,
        [grantIds],
      );
      await transaction.query(
        `delete from audit_event where "subjectId" = any($1::text[])`,
        [grantIds],
      );
      await transaction.query(
        `delete from access_grant_domain where "accessGrantId" = any($1::text[])`,
        [grantIds],
      );
      await transaction.query(
        `delete from access_grant_owner_assignment where "accessGrantId" = any($1::text[])`,
        [grantIds],
      );
      await transaction.query(
        `delete from access_grant_code where "accessGrantId" = any($1::text[])`,
        [grantIds],
      );
      await transaction.query(
        `delete from access_grant where id = any($1::text[])`,
        [grantIds],
      );
    });
  }
  if (organizationIds.length > 0)
    await database.query(
      `delete from organization
       where id = any($1::text[])
         and name = $2
         and not exists (
           select 1 from access_grant where "organizationId" = organization.id
         )`,
      [organizationIds, organizationName],
    );
}

test("secure local origin negotiates compression", async ({ page }) => {
  test.skip(
    process.env.PLAYWRIGHT_HTTPS !== "true",
    "Compression negotiation is exercised by the HTTPS browser gate.",
  );
  const assetResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return pathname.startsWith("/assets/") && pathname.endsWith(".js");
  });
  const documentResponse = await page.goto("/");
  expect(documentResponse).not.toBeNull();
  expect(await documentResponse?.headerValue("content-encoding")).toBe("gzip");
  expect(await documentResponse?.headerValue("vary")).toContain(
    "Accept-Encoding",
  );
  const assetResponse = await assetResponsePromise;
  expect(await assetResponse.headerValue("content-encoding")).toBe("br");
  expect(await assetResponse.headerValue("vary")).toContain("Accept-Encoding");
});

test("public catalogue is responsive, accessible and CSP-hardened", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).not.toMatch(/script-src [^;]*unsafe-inline/);
  const nonce = await page
    .locator('meta[property="csp-nonce"]')
    .first()
    .evaluate((element: HTMLMetaElement) => element.nonce);
  expect(nonce).not.toBe("");
  const stylesheet = await page
    .locator('link[rel="stylesheet"]')
    .first()
    .getAttribute("href");
  expect(stylesheet).toMatch(/^\/assets\//);
  const clientAssetResponse = await page.request.get(stylesheet ?? "");
  expect(clientAssetResponse.status()).toBe(200);
  expect(clientAssetResponse.headers()["content-type"]).toContain("text/css");
  expect(clientAssetResponse.headers()["cache-control"]).toContain("immutable");
  expect(
    await page
      .locator("style")
      .evaluateAll(
        (elements, expectedNonce) =>
          elements.every((element) => element.nonce === expectedNonce),
        nonce,
      ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Skills that make work better." }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("server-rendered navigation and actions stay visible before hydration", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string")
    throw new Error("Playwright baseURL is required");

  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    "light",
  );
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  const exploreCourses = page.getByRole("link", { name: "Explore courses" });
  await expect(exploreCourses).toBeVisible();
  await expect(exploreCourses).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await page.goto("/courses");
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();

  await page.goto("/login");
  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeVisible();
  await expect(signIn).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/x-icon");
  const homepageBackground = await page.request.get(
    "/brand/home-arrow-background.jpg",
  );
  expect(homepageBackground.status()).toBe(200);
  expect(homepageBackground.headers()["content-type"]).toContain("image/jpeg");
  const manifest = await page.request.get("/site.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  await context.close();
});

test("validated catalogue search remains navigable", async ({ page }) => {
  await page.goto("/courses?q=work&topic=all&page=1");
  await expect(page.getByText("Psychological safety at work")).toBeVisible();
  await expect(page.getByText("Responsible AI foundations")).toHaveCount(0);

  await page.goto("/courses?q=safety&topic=safety&page=1");
  await expect(
    page.getByRole("heading", { name: "Find your next skill" }),
  ).toBeVisible();
  await expect(page.getByText("Psychological safety at work")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear search filter: safety" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear topic filter: Safety" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear search filter: safety" })
    .click();
  await expect(page).toHaveURL(/\/courses\/?\?q=&topic=safety&page=1$/);
  await expect(
    page.getByRole("button", { name: "Clear search filter: safety" }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Psychological safety at work", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Psychological safety at work" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Course outline" }),
  ).toBeVisible();
  await expect(page.getByText(/1 CPD point/)).toBeVisible();
  await page.getByRole("button", { name: "Enrol in this course" }).click();
  await expect(page).toHaveURL(/\/courses\/psychological-safety-at-work$/);
  await expect(
    page.getByRole("heading", { name: "Create your Upskill account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Email account setup" }).click();
  await expect(page.getByText("Enter the person's name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your Upskill account" }),
  ).toHaveCount(0);
  await page.goto("/login?redirect=%2Fcourses%2Fpsychological-safety-at-work");
  await expect(
    page.getByRole("heading", { name: "Sign in to Upskill" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});

test("bulk-order pricing is responsive and route-split from course detail", async ({
  page,
}) => {
  await page.goto("/courses/psychological-safety-at-work");
  await page.getByRole("link", { name: "Purchase bulk access" }).click();
  await expect(page).toHaveURL(
    /\/courses\/psychological-safety-at-work\/bulk-order$/u,
  );
  await expect(
    page.getByRole("heading", {
      name: "Purchase Psychological safety at work",
    }),
  ).toBeVisible();
  await page.getByLabel("Organisation name").fill("Browser Test Health");
  await page.getByLabel("Number of seats").fill("20");
  await expect(
    page
      .getByText("Price per seat", { exact: true })
      .locator("..")
      .getByText("$59.00", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$1,180.00", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("Stripe webhook rejects an invalid signature", async ({ request }) => {
  const response = await request.post("/api/stripe/webhook", {
    data: { type: "checkout.session.completed" },
    headers: { "stripe-signature": "invalid" },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "invalid_webhook" });
});

test("SCORM launch boundaries reject the wrong origin and missing session", async ({
  request,
}, testInfo) => {
  const crossOrigin = await request.post("/api/scorm/launches", {
    data: {
      enrollmentId: "enrollment_local_leading_change",
      modulePosition: 0,
    },
    headers: { origin: "https://attacker.example" },
  });
  expect(crossOrigin.status()).toBe(403);

  const unauthenticated = await request.post("/api/scorm/launches", {
    data: {
      enrollmentId: "enrollment_local_leading_change",
      modulePosition: 0,
    },
    headers: { origin: new URL(testInfo.project.use.baseURL ?? "").origin },
  });
  expect(unauthenticated.status()).toBe(401);

  const mainOriginExchange = await request.get(
    `/api/scorm/launch?token=${"a".repeat(43)}`,
  );
  expect(mainOriginExchange.status()).toBe(404);

  const learningProtocol =
    process.env.PLAYWRIGHT_HTTPS === "true" ? "https" : "http";
  const learningOrigin = process.env.PLAYWRIGHT_LEARNING_PORT
    ? `${learningProtocol}://127.0.0.1:${process.env.PLAYWRIGHT_LEARNING_PORT}`
    : (process.env.LEARNING_ORIGIN ?? "http://127.0.0.1:3001");
  const missingAttemptSession = await request.get(
    `${learningOrigin}/api/scorm/attempts/missing_attempt?runtime=script`,
  );
  expect(missingAttemptSession.status()).toBe(401);
  expect(missingAttemptSession.headers()["content-security-policy"]).toContain(
    "'unsafe-eval'",
  );
  expect(missingAttemptSession.headers()["content-security-policy"]).toContain(
    `frame-ancestors 'self' ${new URL(testInfo.project.use.baseURL ?? "").origin}`,
  );
  expect(missingAttemptSession.headers()["content-security-policy"]).toContain(
    "frame-src 'self' https://embed.articulateusercontent.com",
  );
});

test("learners run SCORM inside the course workspace", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile-scorm",
    "The complete SCORM player journey runs once; boundaries remain cross-browser.",
  );
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  const ids = {
    course: "e2e_scorm_player_course",
    courseVersion: "e2e_scorm_player_course_version",
    enrollment: "e2e_scorm_player_enrollment",
    package: "e2e_scorm_player_package",
    packageVersion: "e2e_scorm_player_package_version",
  };
  const sectionId = "e2e_scorm_player_section";
  const itemId = "e2e_scorm_player_item";
  await database.connect();
  try {
    await cleanupLearnerScormPlayerFixture(database, ids);
    const learner = await database.query<{ id: string }>(
      `select id from "user" where email = 'admin@codestudio.au'`,
    );
    const learnerId = learner.rows[0]?.id;
    expect(learnerId).toBeTruthy();
    await database.query(
      `insert into course (id, slug, title, status) values ($1, $2, $3, 'published')`,
      [ids.course, "e2e-scorm-player", "E2E SCORM player course"],
    );
    await database.query(
      `insert into course_version (id, "courseId", version, content, "publishedAt") values ($1, $2, 1, $3::jsonb, now())`,
      [
        ids.courseVersion,
        ids.course,
        JSON.stringify({
          title: "E2E SCORM player course",
          summary: "Verifies embedded learner playback.",
          description: "Browser fixture",
          topic: "technology",
          durationMinutes: 5,
          priceCents: 0,
          salePriceCents: null,
          currency: "AUD",
          featured: false,
          listInStore: false,
          hasCompletionCertificate: false,
          prerequisites: [],
          accreditations: [],
          modules: [
            {
              title: "E2E embedded module",
              phase: "content",
              durationMinutes: 5,
            },
          ],
        }),
      ],
    );
    await database.query(
      `insert into learning_activity (id, kind, title) values ($1, 'scorm', $2)`,
      [ids.package, "E2E embedded package"],
    );
    await database.query(
      `insert into learning_activity_version
        (id, "activityId", kind, version, "publishedAt")
       values ($1, $2, 'scorm', 1, now())`,
      [ids.packageVersion, ids.package],
    );
    await database.query(
      `insert into scorm_package_version
        (id, status, standard, "contentPrefix", "launchPath", sha256, manifest, "sourceBytes", "processedAt")
       values ($1, 'ready', 'scorm-1.2', 'e2e/scorm/player', 'index.html', $2, '{}'::jsonb, 1024, now())`,
      [ids.packageVersion, "9".repeat(64)],
    );
    await database.query(
      `insert into course_version_section (id, "courseVersionId", position, title, description) values ($1, $2, 0, $3, $4)`,
      [sectionId, ids.courseVersion, "Learning", "Complete the module."],
    );
    await database.query(
      `insert into course_version_item
        (id, "courseVersionId", "sectionId", position, kind, title, required, "durationMinutes", "modulePosition", "learningActivityVersionId")
       values ($1, $2, $3, 0, 'scorm', $4, true, 5, 0, $5)`,
      [
        itemId,
        ids.courseVersion,
        sectionId,
        "E2E embedded module",
        ids.packageVersion,
      ],
    );
    await database.query(
      `insert into enrollment
        (id, "userId", "courseVersionId", status, "enrolledAt")
       values ($1, $2, $3, 'active', now())`,
      [ids.enrollment, learnerId, ids.courseVersion],
    );

    const learningProtocol =
      process.env.PLAYWRIGHT_HTTPS === "true" ? "https" : "http";
    const learningOrigin = process.env.PLAYWRIGHT_LEARNING_PORT
      ? `${learningProtocol}://127.0.0.1:${process.env.PLAYWRIGHT_LEARNING_PORT}`
      : (process.env.LEARNING_ORIGIN ?? "http://127.0.0.1:3001");
    await page.route(
      `${learningOrigin}/api/scorm/attempts/*/content/index.html`,
      async (route) => {
        await route.fulfill({
          body: `<!doctype html><html><body><h1>Embedded SCO loaded</h1><button id="complete" type="button">Complete module</button><script>
            const api = window.parent.API;
            api.LMSInitialize("");
            document.getElementById("complete").addEventListener("click", () => {
              api.LMSSetValue("cmi.core.lesson_status", "completed");
              api.LMSSetValue("cmi.core.lesson_location", "finished");
              api.LMSFinish("");
            });
          </script></body></html>`,
          contentType: "text/html",
          headers: {
            "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self' ${new URL(testInfo.project.use.baseURL ?? "").origin}`,
          },
          status: 200,
        });
      },
    );
    await page.goto("/login");
    await page.getByLabel("Email address").fill("admin@codestudio.au");
    await page
      .locator('input[name="password"]')
      .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(`/learn/${ids.enrollment}`);
    const moduleCard = page.getByRole("listitem").filter({
      has: page.getByText("E2E embedded module", { exact: true }),
    });
    await moduleCard.getByRole("button", { name: "Launch" }).click();
    await expect(moduleCard.locator("iframe")).toHaveAttribute(
      "sandbox",
      "allow-downloads allow-popups allow-same-origin allow-scripts",
    );
    const shell = page.frameLocator('iframe[title="E2E embedded module"]');
    const sco = shell.frameLocator("#scorm-content");
    await expect(
      sco.getByRole("heading", { name: "Embedded SCO loaded" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(true);
    await page.getByRole("button", { name: "Click here to exit" }).click();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(false);
    await expect(moduleCard.locator("iframe")).toHaveCount(0);
    await moduleCard.getByRole("button", { name: "Launch" }).click();
    await expect(
      page
        .frameLocator('iframe[title="E2E embedded module"]')
        .frameLocator("#scorm-content")
        .getByRole("heading", { name: "Embedded SCO loaded" }),
    ).toBeVisible();
    await sco.getByRole("button", { name: "Complete module" }).click();
    await expect(page).toHaveURL(`/learn/${ids.enrollment}`);
    await expect
      .poll(async () => {
        const attempt = await database.query<{ status: string }>(
          `select status from scorm_attempt where "enrollmentId" = $1 order by "attemptNumber" desc limit 1`,
          [ids.enrollment],
        );
        return attempt.rows[0]?.status;
      })
      .toBe("completed");
    await expect(shell.getByText("Module progress saved.")).toBeVisible();
    await expect(
      moduleCard.getByText("Completed", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await moduleCard.getByRole("button", { name: "Launch" }).click();
    await expect(
      page
        .frameLocator('iframe[title="E2E embedded module"]')
        .frameLocator("#scorm-content")
        .getByRole("heading", { name: "Embedded SCO loaded" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const attempts = await database.query<{ count: number }>(
          `select count(*)::integer as count from scorm_attempt where "enrollmentId" = $1 and "modulePosition" = 0`,
          [ids.enrollment],
        );
        return attempts.rows[0]?.count;
      })
      .toBe(1);
  } finally {
    await cleanupLearnerScormPlayerFixture(database, ids);
    await database.end();
  }
});

test("SCORM administration uploads enforce origin and authentication", async ({
  request,
}, testInfo) => {
  const archive = "PK\u0003\u0004boundary-test";
  const uploadUrl = "/api/admin/scorm-packages?title=Boundary%20test";
  const sharedHeaders = {
    "content-length": String(Buffer.byteLength(archive)),
    "content-type": "application/zip",
  };
  const crossOrigin = await request.post(uploadUrl, {
    data: archive,
    headers: { ...sharedHeaders, origin: "https://attacker.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  await expect(crossOrigin.json()).resolves.toEqual({
    error: "invalid_origin",
  });

  const invalidMime = await request.post(uploadUrl, {
    data: archive,
    headers: {
      ...sharedHeaders,
      "content-type": "application/zip-archive",
      origin: new URL(testInfo.project.use.baseURL ?? "").origin,
    },
  });
  expect(invalidMime.status()).toBe(415);
  await expect(invalidMime.json()).resolves.toEqual({
    error: "invalid_content_type",
  });

  const unauthenticated = await request.post(uploadUrl, {
    data: archive,
    headers: {
      ...sharedHeaders,
      origin: new URL(testInfo.project.use.baseURL ?? "").origin,
    },
  });
  expect(unauthenticated.status()).toBe(401);
  await expect(unauthenticated.json()).resolves.toEqual({
    error: "unauthenticated",
  });

  const unauthenticatedRemoval = await request.delete(
    `${uploadUrl}&packageVersionId=scorm_pkgv_boundary`,
    {
      headers: {
        origin: new URL(testInfo.project.use.baseURL ?? "").origin,
      },
    },
  );
  expect(unauthenticatedRemoval.status()).toBe(401);
  await expect(unauthenticatedRemoval.json()).resolves.toEqual({
    error: "unauthenticated",
  });
});

test("learner dashboard requires a server-validated session", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to Upskill" }),
  ).toBeVisible();

  await page.goto("/learn/enrollment_local_leading_change");
  await expect(page).toHaveURL(
    /\/login\?redirect=%2Flearn%2Fenrollment_local_leading_change$/,
  );
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fprofile$/);
});

test("learners can end their authenticated session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@codestudio.au");
  await page
    .locator('input[name="password"]')
    .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page
    .locator(
      'header summary[aria-label="Navigation menu"]:visible, header summary[aria-label$="account menu"]:visible',
    )
    .click();
  await page.getByRole("link", { name: /profile/iu }).click();
  await expect(page).toHaveURL(/\/profile$/u);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue(/.+/u);
  await expect(page.getByText("Contact verification")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page
    .locator(
      'header summary[aria-label="Navigation menu"]:visible, header summary[aria-label$="account menu"]:visible',
    )
    .click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
});

test("provisional learners can activate an account from a setup link", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "The account-activation journey runs once across the browser matrix.",
  );
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  const userId = "e2e_provisional_account";
  const token = "a".repeat(43);
  await database.connect();
  try {
    await database.query(
      `insert into "user"
        (id, name, email, "emailVerified", "accountState", "provisioningSource", "setupRequestedAt")
       values ($1, 'E2E Provisional Learner', 'e2e-provisional@example.com', false,
        'provisional', 'administrator', now())`,
      [userId],
    );
    await database.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values ('e2e_account_setup_verification', $1, $2, now() + interval '1 hour', now(), now())`,
      [`reset-password:${token}`, userId],
    );

    await page.goto(`/account/setup#token=${token}`);
    await expect(page).toHaveURL(/\/account\/setup$/u);
    await expect(
      page.getByRole("heading", { name: "Set up your account" }),
    ).toBeVisible();
    await page
      .getByLabel("Password *", { exact: true })
      .fill("e2e-account-password");
    await page.getByLabel("Confirm password").fill("e2e-account-password");
    await page
      .getByRole("button", { name: "Set password and continue" })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(
      page.getByRole("heading", { name: "My learning" }),
    ).toBeVisible();

    const activated = await database.query<{
      accountState: string;
      emailVerified: boolean;
      activatedAt: Date | null;
    }>(
      `select "accountState", "emailVerified", "activatedAt" from "user" where id = $1`,
      [userId],
    );
    expect(activated.rows[0]).toMatchObject({
      accountState: "active",
      emailVerified: true,
    });
    expect(activated.rows[0]?.activatedAt).toBeInstanceOf(Date);
  } finally {
    await withPgAuditMaintenance(database, async (transaction) => {
      await transaction.query(
        `delete from audit_event where "subjectId" = $1`,
        [userId],
      );
    });
    await database.query(`delete from session where "userId" = $1`, [userId]);
    await database.query(`delete from account where "userId" = $1`, [userId]);
    await database.query(`delete from verification where value = $1`, [userId]);
    await database.query(`delete from "user" where id = $1`, [userId]);
    await database.end();
  }
});

test("platform administrators can inspect learner progress", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  test.skip(
    testInfo.project.name !== "chromium-mobile-admin",
    "The complete admin journey runs once; learner authentication remains cross-browser.",
  );

  await page.goto("/login?redirect=%2Fadmin");
  await page.getByLabel("Email address").fill("admin@codestudio.au");
  await page
    .locator('input[name="password"]')
    .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("heading", { name: "Administration" }),
  ).toBeVisible();
  await expect(page.getByText("Registered learners")).toBeVisible();

  const authoringDatabase = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  const authoringSlug = "e2e-editable-course-draft";
  const surveyTitles = ["E2E survey draft", "E2E edited survey"];
  const resourceTitle = "E2E resource library PDF";
  const resourceId = "e2e_resource_library";
  const resourceVersionId = "e2e_resource_library_version";
  const accessGrantLabel = "E2E organisation access";
  const accessOrganizationName = "E2E Access Organisation";
  const accessCodeBase = "E2E-ACCESS-2027";
  const eventTemplateTitle = "E2E virtual workshop";
  const eventOccurrenceTitle = "E2E virtual workshop · August";
  const eventSlug = "e2e-virtual-workshop-august";
  const eventRegionId = "e2e_event_region";
  const eventOccurrenceRegionId = "e2e_event_occurrence_region";
  const eventCoordinatorEligibilityId = "e2e_event_coordinator_eligibility";
  const eventPresenter = {
    id: "e2e_event_presenter",
    name: "E2E Event Presenter",
    email: "e2e-event-presenter@example.com",
  };
  async function openAdminPage(name: string): Promise<void> {
    const menu = page.locator('details[aria-label="Administration menu"]');
    if (!(await menu.evaluate((element: HTMLDetailsElement) => element.open))) {
      await menu.locator("summary").click();
    }
    await menu.getByRole("link", { name, exact: true }).click();
  }
  await authoringDatabase.connect();
  try {
    await cleanupCourseAuthoringFixture(authoringDatabase, authoringSlug);
    await cleanupEventAuthoringFixture(authoringDatabase, eventTemplateTitle);
    await cleanupSurveyAuthoringFixture(authoringDatabase, surveyTitles);
    await cleanupResourceFixture(authoringDatabase, resourceTitle, [
      resourceVersionId,
    ]);
    await cleanupAccessGrantFixture(
      authoringDatabase,
      accessGrantLabel,
      accessOrganizationName,
    );
    await cleanupEventStaffFixture(authoringDatabase, eventPresenter.id);
    await authoringDatabase.query(
      `delete from coordination_region where id = $1`,
      [eventRegionId],
    );
    await authoringDatabase.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)`,
      [eventPresenter.id, eventPresenter.name, eventPresenter.email],
    );
    await openAdminPage("Enterprise contracts");
    await expect(
      page.getByRole("heading", { name: "Enterprise contracts", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create contract" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    const enterpriseContractAccessibility = await new AxeBuilder({
      page,
    }).analyze();
    expect(enterpriseContractAccessibility.violations).toEqual([]);
    await page.getByRole("link", { name: "Create contract" }).click();
    await expect(page).toHaveURL("/admin/contracts/new");
    await expect(
      page.getByRole("heading", {
        name: "Create enterprise contract",
        exact: true,
      }),
    ).toBeVisible();
    const courseCoverageCombobox = page.getByRole("combobox", {
      name: "Add covered courses",
    });
    await expect(courseCoverageCombobox).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: "Add covered scheduled events",
      }),
    ).toBeVisible();
    const domainInput = page.getByRole("textbox", {
      name: "Eligible verified-email domains",
    });
    await domainInput.fill("example.org");
    await domainInput.press("Enter");
    const addedDomains = page.getByLabel(
      "Eligible verified-email domains added",
    );
    await expect(
      addedDomains.getByText("example.org", { exact: true }),
    ).toBeVisible();
    await addedDomains.getByRole("button", { name: "Remove" }).click();
    await expect(addedDomains).not.toBeVisible();
    const ownerInput = page.getByRole("textbox", {
      name: "Contract Access Owners",
    });
    await ownerInput.fill("owner@example.org");
    await ownerInput.press("Enter");
    const addedOwners = page.getByLabel("Contract Access Owners added");
    await expect(
      addedOwners.getByText("owner@example.org", { exact: true }),
    ).toBeVisible();
    await addedOwners.getByRole("button", { name: "Remove" }).click();
    await expect(addedOwners).not.toBeVisible();
    await courseCoverageCombobox.click();
    await page.getByRole("option").first().click();
    const selectedCourseCoverage = page.getByLabel("Covered courses selected");
    await expect(selectedCourseCoverage).toBeVisible();
    await selectedCourseCoverage
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(
      page.getByText("No courses added.", { exact: true }),
    ).toBeVisible();
    const enterpriseContractCreateAccessibility = await new AxeBuilder({
      page,
    }).analyze();
    expect(enterpriseContractCreateAccessibility.violations).toEqual([]);
    await page
      .getByLabel("Contract name")
      .fill("E2E pending identity contract");
    await page.getByLabel("Contract reference").fill("E2E-PENDING-IDENTITY");
    await page.getByLabel("Organisation").fill("E2E Health");
    await page.getByLabel("Shared eligibility code").fill("E2E-CONTRACT-2027");
    await page.getByLabel("Starts").fill("2027-01-01");
    await page.getByLabel("Ends").fill("2027-12-31");
    await courseCoverageCombobox.click();
    await page.getByRole("option").first().click();
    await domainInput.fill("Pending.Example.ORG");
    await page.getByRole("button", { name: "Create draft contract" }).click();
    await expect(
      page.getByRole("heading", { name: "Contract draft created" }),
    ).toBeVisible();
    const pendingIdentityContract = await authoringDatabase.query<{
      id: string;
    }>(`select id from enterprise_contract where reference = $1`, [
      "E2E-PENDING-IDENTITY",
    ]);
    expect(pendingIdentityContract.rows).toHaveLength(1);
    const pendingIdentityDomains = await authoringDatabase.query<{
      domain: string;
    }>(
      `select domain
         from enterprise_contract_domain
        where "enterpriseContractId" = $1`,
      [pendingIdentityContract.rows[0]?.id],
    );
    expect(pendingIdentityDomains.rows).toEqual([
      { domain: "pending.example.org" },
    ]);
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    const enterpriseContractSuccessAccessibility = await new AxeBuilder({
      page,
    }).analyze();
    expect(enterpriseContractSuccessAccessibility.violations).toEqual([]);
    await page.getByRole("link", { name: "View enterprise contracts" }).click();
    await expect(
      page.getByRole("heading", { name: "Enterprise contracts", exact: true }),
    ).toBeVisible();
    await openAdminPage("Email designer");
    await expect(
      page.getByRole("heading", { name: "Email designer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Account setup", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create email" }).click();
    await page.getByLabel("Email name").fill("E2E event confirmation");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(
      page.getByRole("heading", { name: "E2E event confirmation" }),
    ).toBeVisible();
    await page.getByLabel("Subject").fill("Confirmed: {{event.title}}");
    const emailBody = page.getByLabel("Email body");
    await emailBody.fill(
      "Hello ,\n\nYour event starts {{event.startsAt}}.\n\n{{event.dashboardUrl}}",
    );
    await emailBody.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(6, 6);
    });
    await page.getByLabel("Available variables").selectOption("user.fullName");
    await page.getByRole("button", { name: "Add variable" }).click();
    await expect(emailBody).toHaveValue(
      "Hello {{user.fullName}},\n\nYour event starts {{event.startsAt}}.\n\n{{event.dashboardUrl}}",
    );
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(
      page.getByText("Confirmed: Regional learning workshop"),
    ).toBeVisible();
    const emailAccessibility = await new AxeBuilder({ page }).analyze();
    expect(emailAccessibility.violations).toEqual([]);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    await page
      .getByRole("dialog", { name: "Publish version 1?" })
      .getByRole("button", { name: "Publish version" })
      .click();
    await expect(
      page.getByRole("button", { name: "Create new version" }),
    ).toBeVisible();
    await openAdminPage("Courses");
    await expect(
      page.getByRole("heading", { name: "Courses", exact: true }),
    ).toBeVisible();
    const rosterCourse = await authoringDatabase.query<{ id: string }>(
      `select id from course where slug = 'leading-through-change'`,
    );
    const rosterCourseId = rosterCourse.rows[0]?.id;
    expect(rosterCourseId).toBeTruthy();
    await page.goto(
      `/admin/courses/${encodeURIComponent(rosterCourseId ?? "")}`,
    );
    await page.getByRole("button", { name: /Learners/u }).click();
    await expect(
      page.getByRole("heading", { name: "Learner roster" }),
    ).toBeVisible();
    await expect(page.getByLabel("Learner email")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: /^Published version/u }),
    ).toHaveValue("course_version_leading_through_change_1");
    await expect(
      page.getByRole("button", { name: "Add learner" }),
    ).toBeVisible();
    const learnerRow = page.getByRole("row", {
      name: /learner@codestudio\.au/u,
    });
    await expect(
      learnerRow.getByRole("cell", { name: "Version 1", exact: true }),
    ).toBeVisible();
    await expect(
      learnerRow.getByRole("cell", { name: "Status active", exact: true }),
    ).toBeVisible();
    await expect(
      learnerRow.getByRole("link", { name: "Alex Learner" }),
    ).toHaveAttribute(
      "href",
      "/admin/learners/user_local_learner/enrollments/enrollment_local_leading_change",
    );
    await expect(
      learnerRow.getByRole("button", { name: "Remove access" }),
    ).toBeVisible();
    await page.goto("/admin/courses");
    await page.getByRole("button", { name: "Create course" }).click();
    await expect(page).toHaveURL(/\/admin\/courses\/course_/u);
    await expect(
      page.getByRole("heading", { name: "Untitled course", level: 1 }),
    ).toBeVisible();
    await page.getByLabel("Title").fill("E2E edited course draft");
    await page.getByLabel("Friendly URL").fill(authoringSlug);
    await expect(page.getByLabel("Friendly URL")).toHaveValue(authoringSlug);
    await expect(page.getByLabel("Title")).toHaveValue(
      "E2E edited course draft",
    );
    await page.getByLabel("Original price (AUD)").fill("100");
    await page.getByLabel("Allow bulk purchases").check();
    const minimumSeats = page.getByLabel("Minimum seats");
    await minimumSeats.press("ControlOrMeta+A");
    await minimumSeats.pressSequentially("12");
    await expect(minimumSeats).toHaveValue("12");
    await expect(minimumSeats).toBeFocused();
    const pricePerSeat = page.getByLabel("Price per seat (AUD)");
    await pricePerSeat.press("ControlOrMeta+A");
    await pricePerSeat.pressSequentially("75");
    await expect(pricePerSeat).toHaveValue("75");
    await expect(pricePerSeat).toBeFocused();
    await page.getByRole("button", { name: "Program (0)" }).click();
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("heading", { name: "Section 1" }).click();
    await page.getByText("Section details", { exact: true }).click();
    await page.getByLabel("Section title").fill("E2E edited section title");
    await expect(page.getByLabel("Section title")).toHaveValue(
      "E2E edited section title",
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    await openAdminPage("Surveys");
    await expect(
      page.getByRole("heading", { name: "Surveys", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create survey" }).click();
    await page.getByLabel("Survey title").fill(surveyTitles[0] ?? "");
    await page.getByLabel("Survey type").selectOption("event");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.getByLabel("Title").fill(surveyTitles[1] ?? "");
    await page.getByRole("button", { name: /Questions/u }).click();
    await page.getByRole("button", { name: "Add single choice" }).click();
    await page.getByLabel("Question 1").fill("Was this survey useful?");
    await page.getByLabel("Learner-facing label 1").fill("Yes");
    await page.getByLabel("Learner-facing label 2").fill("No");
    await page.getByRole("button", { name: "Add instruction block" }).click();
    await page.getByLabel("Block title").fill("Before you answer");
    await page
      .getByLabel("Instructions")
      .fill("Read this information, then select Next.");
    const surveySections = page.locator("[data-survey-section]");
    const firstSectionItems = surveySections
      .first()
      .locator("[data-survey-item]");
    await firstSectionItems.nth(1).getByRole("button", { name: "Up" }).click();
    await expect(
      firstSectionItems.first().getByLabel("Block title"),
    ).toHaveValue("Before you answer");
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section 2 title").fill("Follow-up");
    await surveySections
      .nth(1)
      .getByRole("button", { name: "Add long text" })
      .click();
    await surveySections
      .nth(1)
      .getByLabel("Question 1")
      .fill("What could be improved?");
    await surveySections
      .nth(1)
      .getByRole("button", { name: "Up" })
      .first()
      .click();
    await expect(page.getByLabel("Section 1 title")).toHaveValue("Follow-up");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await page.getByRole("button", { name: "Publish version" }).click();
    await expect(
      page.getByText("Published versions are immutable"),
    ).toBeVisible();

    await authoringDatabase.query(
      `insert into learning_activity (id, kind, title) values ($1, 'resource', $2)`,
      [resourceId, resourceTitle],
    );
    await authoringDatabase.query(
      `insert into learning_activity_version
        (id, "activityId", kind, version, "publishedAt")
       values ($1, $2, 'resource', 1, now())`,
      [resourceVersionId, resourceId],
    );
    await authoringDatabase.query(
      `insert into learning_resource_version
        (id, "displayName", description, "objectKey", sha256, "sourceBytes", "mediaType")
       values ($1, 'e2e-resource.pdf', 'E2E resource description', $2, $3, 128, 'application/pdf')`,
      [
        resourceVersionId,
        `resources/${resourceVersionId}/${"4".repeat(64)}.pdf`,
        "4".repeat(64),
      ],
    );
    await openAdminPage("PDF resources");
    await expect(
      page.getByRole("heading", { name: "PDF resources" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Upload PDF" }).click();
    await page.getByRole("button", { name: "Upload resource" }).click();
    await expect(page.getByText("Enter a resource title.")).toBeVisible();
    await page.getByLabel("Resource title").fill("Missing document");
    await page.getByRole("button", { name: "Upload resource" }).click();
    await expect(page.getByText("Choose a PDF document.")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    const resourceCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: resourceTitle }),
    });
    await expect(resourceCard.getByText("e2e-resource.pdf")).toBeVisible();
    await resourceCard.getByRole("button", { name: "Remove version" }).click();
    const resourceRemoval = page.getByRole("dialog", {
      name: "Remove resource version?",
    });
    await expect(resourceRemoval).toBeVisible();
    await resourceRemoval
      .getByRole("button", { name: "Remove version" })
      .click();
    await expect(resourceCard).toHaveCount(0);

    await openAdminPage("Access grants");
    await expect(
      page.getByRole("heading", { name: "Access grants", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create grant" }).click();
    await page.getByLabel("Grant label").fill(accessGrantLabel);
    await page.getByLabel("Organisation").fill(accessOrganizationName);
    await page.getByLabel("Access code").fill("E2E Access 2027");
    await page.getByLabel("Available enrolments").fill("3");
    await page.getByLabel("Learner access duration (days)").fill("90");
    await page
      .getByLabel("Permitted email domains (optional)")
      .fill("E2E.EXAMPLE.COM, e2e.example.com");
    await page
      .getByLabel("Access Owner emails")
      .fill("redeemer2@codestudio.au");
    await page.getByRole("button", { name: "Create access grant" }).click();
    await expect(
      page.getByText(
        "Access grant created. Administrators can retrieve this code again later.",
      ),
    ).toBeVisible();
    const issuedCodeElement = page.locator("code");
    await expect(issuedCodeElement).toHaveText(
      /^E2E-ACCESS-2027-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/u,
    );
    const accessCode = await issuedCodeElement.innerText();
    await page.getByRole("button", { name: "Done" }).click();
    const grantCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: accessGrantLabel }),
    });
    await expect(grantCard.getByText("0 of 3")).toBeVisible();
    await grantCard.getByText("Grant details", { exact: true }).click();
    await expect(grantCard.getByText("Domains: e2e.example.com")).toBeVisible();
    const storedGrant = await authoringDatabase.query<{
      encryptedAccessCode: string | null;
      fulfillmentMode: string;
      kind: string;
      lookupId: string;
      quantity: number;
      revokedAt: Date | null;
    }>(
      `select code."lookupId", code."encryptedAccessCode", ag.kind,
          ag."fulfillmentMode", ag.quantity, ag."revokedAt"
       from access_grant as ag
       join access_grant_code as code on code."accessGrantId" = ag.id
       where ag.label = $1 and code.ordinal is null`,
      [accessGrantLabel],
    );
    expect(storedGrant.rows[0]?.lookupId).toBe(accessCode.slice(-10));
    expect(storedGrant.rows[0]?.encryptedAccessCode).toMatch(/^v1\./u);
    expect(storedGrant.rows[0]?.encryptedAccessCode).not.toContain(
      accessCodeBase,
    );
    expect(storedGrant.rows[0]?.quantity).toBe(3);
    expect(storedGrant.rows[0]?.kind).toBe("bulk_purchase");
    expect(storedGrant.rows[0]?.fulfillmentMode).toBe("shared_code");
    expect(storedGrant.rows[0]?.revokedAt).toBeNull();
    await grantCard.getByRole("button", { name: "Show code" }).click();
    await expect(grantCard.locator("code")).toHaveText(accessCode);
    await grantCard.getByRole("button", { name: "Manage capacity" }).click();
    const capacityDialog = page.getByRole("dialog", {
      name: "Manage access capacity",
    });
    await capacityDialog.getByLabel("Total available enrolments").fill("5");
    await capacityDialog.getByRole("button", { name: "Save capacity" }).click();
    await expect(grantCard.getByText("0 of 5")).toBeVisible();
    const expandedGrant = await authoringDatabase.query<{
      encryptedAccessCode: string | null;
      quantity: number;
    }>(
      `select code."encryptedAccessCode", ag.quantity
       from access_grant as ag
       join access_grant_code as code on code."accessGrantId" = ag.id
       where ag.label = $1 and code.ordinal is null`,
      [accessGrantLabel],
    );
    expect(expandedGrant.rows[0]).toEqual({
      encryptedAccessCode: storedGrant.rows[0]?.encryptedAccessCode,
      quantity: 5,
    });
    await grantCard.getByRole("button", { name: "Revoke code" }).click();
    const revocationDialog = page.getByRole("dialog", {
      name: "Revoke access code?",
    });
    await expect(revocationDialog).toBeVisible();
    await revocationDialog.getByRole("button", { name: "Revoke code" }).click();
    await page.getByRole("button", { name: "Revoked (1)" }).click();
    await expect(grantCard.getByText("revoked", { exact: true })).toBeVisible();
    const revokedGrant = await authoringDatabase.query<{
      revokedAt: Date | null;
    }>(`select "revokedAt" from access_grant where label = $1`, [
      accessGrantLabel,
    ]);
    expect(revokedGrant.rows[0]?.revokedAt).not.toBeNull();

    await openAdminPage("Event settings");
    await expect(
      page.getByRole("heading", { name: "Event settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Eligible event staff", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Responsibility").selectOption("coordinator");
    await expect(page.getByLabel("Region")).toBeVisible();
    await page.getByLabel("Responsibility").selectOption("presenter");
    await expect(page.getByLabel("Region")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "User email" })
      .fill(eventPresenter.email);
    await page
      .getByRole("option")
      .filter({ hasText: eventPresenter.email })
      .click();
    await page
      .getByRole("button", { name: "Add eligible staff member" })
      .click();
    await expect(
      page.getByText("Presenter added to the eligible roster."),
    ).toBeVisible();
    await openAdminPage("Event templates");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/event_template_/u);
    await expect(
      page.getByRole("heading", {
        name: "Untitled event template",
        level: 1,
      }),
    ).toBeVisible();
    await page.getByLabel("Title").fill(eventTemplateTitle);
    await page
      .getByLabel("Summary")
      .fill("A reusable Event Template created through the browser.");
    await page
      .getByLabel("Description")
      .fill("Exercises exact-version Event Occurrence scheduling.");
    await page.getByRole("button", { name: "Program (0)" }).click();
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("heading", { name: "New section" }).click();
    await page.getByText("Section details", { exact: true }).click();
    await page.getByLabel("Section title").fill("Event session");
    await page
      .getByLabel("Release relative to")
      .selectOption("occurrence_start");
    const eventItemAdder = page
      .getByText("Add item", { exact: true })
      .locator("..");
    await eventItemAdder.getByLabel("Type").selectOption("session");
    await eventItemAdder.getByRole("button", { name: "Add" }).click();
    await page
      .locator("summary")
      .filter({ hasText: "Event session" })
      .last()
      .click();
    await page.getByLabel("Display title").fill("Live workshop");
    await page.getByLabel("Duration (minutes)").fill("90");
    await page
      .getByRole("combobox", { name: "Add presenter" })
      .fill(eventPresenter.email);
    await page
      .getByRole("option", { name: new RegExp(eventPresenter.email, "u") })
      .click();
    await page
      .getByRole("button", { name: "Add", exact: true })
      .first()
      .click();
    await eventItemAdder.getByLabel("Type").selectOption("survey");
    await eventItemAdder
      .getByLabel("Item")
      .selectOption({ label: `${surveyTitles[0] ?? ""} · v1` });
    await eventItemAdder.getByRole("button", { name: "Add" }).click();
    await eventItemAdder.getByLabel("Type").selectOption("automated_email");
    await eventItemAdder
      .getByLabel("Email template")
      .selectOption({ label: "E2E event confirmation" });
    await eventItemAdder.getByRole("button", { name: "Add" }).click();
    await expect(
      page.getByRole("heading", { name: "Automated email", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Schedule label")
      .fill("E2E registration confirmation");
    await page
      .getByLabel("Email template")
      .selectOption({ label: "E2E event confirmation · v1" });
    await expect(page.getByLabel("Subject")).toHaveValue(
      "Confirmed: {{event.title}}",
    );
    await expect(page.getByLabel("Email body")).toHaveValue(
      /Your event starts \{\{event\.startsAt\}\}\./u,
    );
    await page.getByLabel("Trigger").selectOption("registration_selected");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(
      page.getByText(`Confirmed: ${eventTemplateTitle}`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Apply email" }).click();
    await page.getByRole("heading", { name: "Event session" }).click();
    await expect(page.getByText("E2E registration confirmation")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Staffing and regions" }).click();
    await expect(
      page.getByRole("combobox", { name: "Add administrator" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save and publish" }).click();
    await expect(
      page.getByRole("button", { name: "Create new version" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create new version" }).click();
    await page
      .getByLabel("Template version")
      .selectOption({ label: "Version 1 · Published" });
    await expect(page.getByLabel("Title")).toBeDisabled();
    await page
      .getByLabel("Template version")
      .selectOption({ label: "Version 2 · Draft" });
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page
      .getByRole("dialog", { name: "Delete draft version?" })
      .getByRole("button", { name: "Delete draft" })
      .click();
    await expect(page.getByLabel("Template version")).toHaveValue(
      /event_template_version_/u,
    );
    await page.getByRole("button", { name: "Back to event templates" }).click();
    await expect(
      page.getByRole("heading", { name: eventTemplateTitle }),
    ).toBeVisible();
    await openAdminPage("Scheduled events");
    await page.getByRole("link", { name: "Schedule event" }).click();
    await expect(
      page.getByRole("heading", { name: "Schedule new event" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    await page.getByLabel("Event title").fill(eventOccurrenceTitle);
    await expect(page.getByLabel("Friendly URL")).toHaveValue(eventSlug);
    await page.getByLabel("Event timezone").fill("Sydney — Australia");
    await page
      .getByRole("textbox", { name: "Starts" })
      .fill("21/08/2027 09:00");
    await page.getByRole("textbox", { name: "Ends" }).fill("21/08/2027 10:30");
    await page
      .getByLabel("Protected virtual meeting URL")
      .fill("https://meet.example.com/e2e-workshop");
    await page.getByRole("button", { name: "Create draft event" }).click();
    const occurrenceHeading = page.getByRole("heading", {
      name: eventOccurrenceTitle,
    });
    await expect(occurrenceHeading).toBeVisible();
    const occurrenceCard = page.getByRole("article").filter({
      has: occurrenceHeading,
    });
    await occurrenceCard.getByRole("button", { name: "Publish event" }).click();
    await expect(
      occurrenceCard.getByText("published", { exact: true }),
    ).toBeVisible();
    const storedOccurrence = await authoringDatabase.query<{
      id: string;
      eventTemplateVersionId: string;
      slug: string;
      status: string;
      timezone: string;
      startsAt: Date;
      sessionCount: number;
      administratorCount: number;
      presenterCount: number;
      surveyAccessCount: number;
      communicationCount: number;
    }>(
      `select occurrence.id, occurrence."eventTemplateVersionId", occurrence.slug, occurrence.status,
        occurrence.timezone, occurrence."startsAt",
        (select count(*)::integer from event_session where "eventOccurrenceId" = occurrence.id) as "sessionCount",
        (select count(*)::integer from event_admin_assignment where "eventOccurrenceId" = occurrence.id and "endedAt" is null) as "administratorCount",
        (select count(*)::integer from event_presenter_assignment where "eventOccurrenceId" = occurrence.id and "endedAt" is null) as "presenterCount",
        (select count(*)::integer from event_survey_access where "eventOccurrenceId" = occurrence.id and "revokedAt" is null) as "surveyAccessCount",
        (select count(*)::integer from event_occurrence_communication_revision where "eventOccurrenceId" = occurrence.id and active) as "communicationCount"
       from event_occurrence occurrence where occurrence.title = $1`,
      [eventOccurrenceTitle],
    );
    expect(storedOccurrence.rows[0]).toMatchObject({
      slug: eventSlug,
      status: "published",
      timezone: "Australia/Sydney",
      startsAt: new Date("2027-08-20T23:00:00.000Z"),
      sessionCount: 1,
      administratorCount: 1,
      presenterCount: 1,
      surveyAccessCount: 1,
      communicationCount: 1,
    });
    const occurrenceId = storedOccurrence.rows[0]?.id;
    if (!occurrenceId) throw new Error("Expected the E2E Event Occurrence");
    const administrator = await authoringDatabase.query<{
      id: string;
      name: string;
      email: string;
    }>(
      `select id, name, email from "user" where email = 'admin@codestudio.au'`,
    );
    const administratorUser = administrator.rows[0];
    if (!administratorUser)
      throw new Error("Expected the seeded administrator");
    await authoringDatabase.query(
      `insert into coordination_region (id, code, name, kind, status)
       values ($1, 'E2E-REGION', 'E2E Region', 'operational', 'active')`,
      [eventRegionId],
    );
    await authoringDatabase.query(
      `insert into event_staff_eligibility
        (id, "userId", responsibility, "regionId", "grantedByUserId", "grantedAt")
       values ($1, $2, 'coordinator', $3, $4, now())`,
      [
        eventCoordinatorEligibilityId,
        eventPresenter.id,
        eventRegionId,
        administratorUser.id,
      ],
    );
    await authoringDatabase.query(
      `insert into event_occurrence_region
        (id, "eventOccurrenceId", "regionId", position)
       values ($1, $2, $3, 1)`,
      [eventOccurrenceRegionId, occurrenceId, eventRegionId],
    );
    await authoringDatabase.query(
      `insert into event_coordinator_assignment
        (id, "eventOccurrenceRegionId", "userId", source, "assignedByUserId", "assignedAt")
       values ('e2e_event_coordinator_assignment', $1, $2, 'occurrence_local', $3, now())`,
      [eventOccurrenceRegionId, eventPresenter.id, administratorUser.id],
    );
    await page.goto("/admin/events/settings?view=staff");
    const assignedCoordinatorCard = page.getByRole("article").filter({
      hasText: `${eventPresenter.email} · E2E Region`,
    });
    await assignedCoordinatorCard
      .getByRole("button", { name: "Remove eligibility" })
      .click();
    const coordinatorCoverageAlert = page.getByRole("alert").filter({
      hasText: "Replacement coordinator required",
    });
    await expect(coordinatorCoverageAlert).toBeVisible();
    await expect(coordinatorCoverageAlert).toContainText(eventOccurrenceTitle);
    await expect(
      coordinatorCoverageAlert.getByRole("link", {
        name: "Configure coordinators",
      }),
    ).toBeVisible();
    const registrationId = "e2e_event_learner_registration";
    const participationId = "e2e_event_learner_participation";
    await authoringDatabase.query(
      `insert into event_registration
        (id, "eventOccurrenceId", "userId", "eventOccurrenceRegionId", "reviewRoundId",
          "nameSnapshot", "emailSnapshot", source, "eligibilitySource", status,
          "finalDecidedAt", "finalDecidedByUserId", "lockedInAt")
       values ($1, $2, $3, null, null, $4, $5, 'administrator_override',
          'administrator_override', 'selected', now(), $3, now())`,
      [
        registrationId,
        occurrenceId,
        administratorUser.id,
        administratorUser.name,
        administratorUser.email,
      ],
    );
    await authoringDatabase.query(
      `update event_occurrence set "confirmedCount" = 1 where id = $1`,
      [occurrenceId],
    );
    await authoringDatabase.query(
      `insert into event_participation
        (id, "eventOccurrenceId", "userId", "registrationId", mode,
          "nameSnapshot", "emailSnapshot")
       values ($1, $2, $3, $4, 'registered', $5, $6)`,
      [
        participationId,
        occurrenceId,
        administratorUser.id,
        registrationId,
        administratorUser.name,
        administratorUser.email,
      ],
    );
    await authoringDatabase.query(
      `insert into event_registration
        (id, "eventOccurrenceId", "userId", "eventOccurrenceRegionId", "reviewRoundId",
          "nameSnapshot", "emailSnapshot", source, "eligibilitySource", status,
          "coordinatorDecidedAt", "coordinatorDecidedByUserId")
       values ('e2e_event_declined_registration', $1, $2, $3, null, $4, $5,
          'ordinary', 'unrestricted', 'coordinator_declined', now(), $2)`,
      [
        occurrenceId,
        eventPresenter.id,
        eventOccurrenceRegionId,
        eventPresenter.name,
        eventPresenter.email,
      ],
    );
    const occurrenceSession = await authoringDatabase.query<{ id: string }>(
      `select id from event_session where "eventOccurrenceId" = $1 order by position limit 1`,
      [occurrenceId],
    );
    const occurrenceSessionId = occurrenceSession.rows[0]?.id;
    if (!occurrenceSessionId) throw new Error("Expected the E2E Event Session");
    await authoringDatabase.query(
      `insert into event_attendance
        ("eventParticipationId", "eventSessionId", state, source,
          "recordedByUserId", "recordedAt", "updatedAt")
       values ($1, $2, 'attended', 'administrator', $3, now(), now())`,
      [participationId, occurrenceSessionId, administratorUser.id],
    );
    await page.goto(
      `/admin/events/instances/${occurrenceId}?view=registrations`,
    );
    const finalisedRegistrationRow = page.getByRole("row").filter({
      hasText: administratorUser.email,
    });
    await expect(finalisedRegistrationRow).toBeVisible();
    await expect(
      finalisedRegistrationRow.getByLabel(
        `Final decision for ${administratorUser.name}`,
      ),
    ).toHaveCount(0);
    await expect(finalisedRegistrationRow).toContainText("Confirmed");
    const declinedRegistrationRow = page.getByRole("row").filter({
      hasText: eventPresenter.email,
    });
    await expect(declinedRegistrationRow).toContainText("Not approved");
    await expect(declinedRegistrationRow).not.toContainText("Pending");
    await page.getByRole("link", { name: "Participant progress" }).click();
    await expect(page).toHaveURL(/view=progress/u);
    await expect(
      page.getByRole("heading", { name: "Participant progress" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText(
      administratorUser.email,
    );
    await expect(page.getByText("1/1 attended")).toBeVisible();
    await page.goto("/my-events");
    const learnerEvent = page.getByRole("heading", {
      name: eventOccurrenceTitle,
    });
    await expect(learnerEvent).toBeVisible();
    await page.locator(`a[href="/my-events/${occurrenceId}"]`).click();
    await expect(page).toHaveURL(`/my-events/${occurrenceId}`);
    await expect(
      page.getByRole("heading", { name: eventOccurrenceTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Event program" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    const accessAccessibility = await new AxeBuilder({ page }).analyze();
    expect(accessAccessibility.violations).toEqual([]);

    await page.goto(
      `/event-operations/${encodeURIComponent(occurrenceId)}?view=progress&q=&state=all`,
    );
    await expect(
      page.getByRole("heading", { name: eventOccurrenceTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Participant progress" }),
    ).toBeVisible();
    await expect(page.getByText("1/1 attended")).toBeVisible();
    await expect(page.getByRole("table")).toContainText(
      administratorUser.email,
    );
    const progressSearch = page.getByLabel("Search participants");
    const applyProgressFilters = page.getByRole("button", {
      name: "Apply filters",
    });
    await progressSearch.fill(administratorUser.email);
    await applyProgressFilters.scrollIntoViewIfNeeded();
    const searchScrollPosition = await page.evaluate(() => window.scrollY);
    await applyProgressFilters.click();
    await expect(progressSearch).toHaveValue(administratorUser.email);
    expect(await page.evaluate(() => window.scrollY)).toBe(
      searchScrollPosition,
    );
    const clearProgressSearch = page.getByRole("button", {
      name: `Clear search filter: ${administratorUser.email}`,
    });
    await clearProgressSearch.scrollIntoViewIfNeeded();
    const clearScrollPosition = await page.evaluate(() => window.scrollY);
    await clearProgressSearch.click();
    await expect(progressSearch).toHaveValue("");
    expect(await page.evaluate(() => window.scrollY)).toBe(clearScrollPosition);
    const progressExport = await page.request.get(
      `/api/event-operations/${encodeURIComponent(occurrenceId)}/progress.csv?q=&state=all`,
    );
    expect(progressExport.status()).toBe(200);
    expect(progressExport.headers()["content-type"]).toContain("text/csv");
    expect(await progressExport.text()).toContain(administratorUser.email);

    const surveyAccess = await authoringDatabase.query<{
      id: string;
      publicReference: string;
    }>(
      `select id, "publicReference" from event_survey_access where "eventOccurrenceId" = $1 and "revokedAt" is null`,
      [occurrenceId],
    );
    const surveyQr = surveyAccess.rows[0];
    if (!surveyQr) throw new Error("Expected an Event Survey QR access record");
    expect(surveyQr.publicReference).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    await page.goto(
      `/event-operations/${encodeURIComponent(occurrenceId)}?view=survey_qr&q=&state=all`,
    );
    await expect(
      page.getByRole("heading", { name: "Survey QR catalogue" }),
    ).toBeVisible();
    await expect(page.getByText(surveyTitles[0] ?? "")).toBeVisible();
    await page.getByRole("link", { name: "Present QR code" }).click();
    await expect(page).toHaveURL(
      `/event-operations/${occurrenceId}/survey-qr/${surveyQr.id}`,
    );
    await expect(
      page.getByRole("img", { name: `QR code for ${surveyTitles[0] ?? ""}` }),
    ).toBeVisible();
    const qrImage = await page.request.get(
      `/api/event-surveys/${surveyQr.publicReference}/qr.svg`,
    );
    expect(qrImage.status()).toBe(200);
    expect(qrImage.headers()["content-type"]).toContain("image/svg+xml");
    expect(await qrImage.text()).toContain("<svg");
    await page.goto(`/event-surveys/${surveyQr.publicReference}`);
    await expect(
      page.getByRole("heading", { name: "Survey unavailable" }),
    ).toBeVisible();
    await authoringDatabase.query(
      `update event_registration
       set status = 'selected', "finalDecidedAt" = now(),
         "finalDecidedByUserId" = $2, "lockedInAt" = now()
       where id = 'e2e_event_declined_registration' and "userId" = $1`,
      [eventPresenter.id, administratorUser.id],
    );
    await authoringDatabase.query(
      `update event_occurrence set "confirmedCount" = 2 where id = $1`,
      [occurrenceId],
    );
    await authoringDatabase.query(
      `insert into event_participation
        (id, "eventOccurrenceId", "userId", "registrationId", mode,
          "nameSnapshot", "emailSnapshot")
       values ('e2e_event_presenter_participation', $1, $2,
         'e2e_event_declined_registration', 'registered', $3, $4)`,
      [
        occurrenceId,
        eventPresenter.id,
        eventPresenter.name,
        eventPresenter.email,
      ],
    );
    await authoringDatabase.query(
      `insert into event_attendance
        ("eventParticipationId", "eventSessionId", state, source,
          "recordedByUserId", "recordedAt", "updatedAt")
       values ('e2e_event_presenter_participation', $1, 'attended',
         'administrator', $2, now(), now())`,
      [occurrenceSessionId, administratorUser.id],
    );
    await page.goto(`/admin/learners/${encodeURIComponent(eventPresenter.id)}`);
    const eventProgressCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: eventOccurrenceTitle }),
    });
    await expect(eventProgressCard).toBeVisible();
    await eventProgressCard
      .getByRole("link", { name: "Review progress" })
      .click();
    await expect(
      page.getByText("Learner event progress", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Overall event completion" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Section progress" }),
    ).toBeVisible();
    const liveWorkshopTask = page.getByRole("group", {
      name: "Task: Live workshop",
    });
    await expect(liveWorkshopTask).toContainText("Completed");
    await expect(liveWorkshopTask).toContainText("Attendance");
    await expect(liveWorkshopTask).toContainText("Attended");
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    const learnerEventProgressAccessibility = await new AxeBuilder({
      page,
    }).analyze();
    expect(learnerEventProgressAccessibility.violations).toEqual([]);
    await page.getByRole("button", { name: "Details" }).click();
    await expect(
      page.getByRole("heading", { name: "Event details" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /History/u }).click();
    await expect(
      page.getByRole("heading", {
        name: "Registration and attendance history",
      }),
    ).toBeVisible();
  } finally {
    await cleanupCourseAuthoringFixture(authoringDatabase, authoringSlug);
    await cleanupEventAuthoringFixture(authoringDatabase, eventTemplateTitle);
    await cleanupSurveyAuthoringFixture(authoringDatabase, surveyTitles);
    await cleanupResourceFixture(authoringDatabase, resourceTitle, [
      resourceVersionId,
    ]);
    await cleanupAccessGrantFixture(
      authoringDatabase,
      accessGrantLabel,
      accessOrganizationName,
    );
    await cleanupEventStaffFixture(authoringDatabase, eventPresenter.id);
    await authoringDatabase.query(
      `delete from coordination_region where id = $1`,
      [eventRegionId],
    );
    await authoringDatabase.end();
  }

  await page.goto("/admin");
  await openAdminPage("Learners");
  await expect(
    page.getByRole("heading", { name: "Learners", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/\/admin\/learners\/?$/);
  await page.evaluate(() => {
    document.documentElement.dataset.clientNavigation = "preserved";
  });
  await page.getByLabel("Search learners").fill("learner@codestudio.au");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Alex Learner")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Clear search filter: learner@codestudio.au",
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.clientNavigation ?? null,
      ),
    )
    .toBe("preserved");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("link", { name: "Alex Learner" }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Learner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Course enrolments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Event participation" }),
  ).toBeVisible();
  await expect(
    page.getByText("This learner has no event registrations or participation."),
  ).toBeVisible();
  await expect(page.getByText("Leading through change")).toBeVisible();
  await page.getByRole("link", { name: "Review progress" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Overall course completion" }),
  ).toBeVisible();
  await expect(page.getByText("Latest administrator correction")).toHaveCount(
    0,
  );
  await expect(page.getByLabel(/Reason for marking/)).toHaveCount(0);
  await page
    .getByRole("button", { name: /Mark course (completed|incomplete)/ })
    .click();
  const correctionDialog = page.getByRole("dialog", {
    name: "Confirm progress correction",
  });
  await expect(correctionDialog).toBeVisible();
  await correctionDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(correctionDialog).toHaveCount(0);
  await page.getByRole("button", { name: /Modules/u }).click();
  await expect(
    page.getByRole("heading", { name: "Module progress" }),
  ).toBeVisible();
  await expect(page.getByLabel(/Reason for marking/)).toHaveCount(0);
  await page.getByRole("button", { name: /Corrections/u }).click();
  await expect(
    page.getByRole("heading", { name: "Correction history" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");

  const database = new Client({ connectionString: process.env.DATABASE_URL });
  const packageId = "e2e_scorm_autorefresh_package";
  const packageVersionId = "e2e_scorm_autorefresh_version";
  await database.connect();
  try {
    await cleanupScormPackageFixture(database, packageId, packageVersionId);
    await database.query(
      `insert into learning_activity (id, kind, title) values ($1, 'scorm', $2)`,
      [packageId, "Automatic verification status"],
    );
    await database.query(
      `insert into learning_activity_version
        (id, "activityId", kind, version)
       values ($1, $2, 'scorm', 1)`,
      [packageVersionId, packageId],
    );
    await database.query(
      `insert into scorm_package_version
        (id, status, standard, "contentPrefix", "launchPath", sha256, manifest, "sourceBytes")
       values ($1, 'processing', 'scorm-1.2', $2, 'pending.html', $3, '{}'::jsonb, 2048)`,
      [
        packageVersionId,
        `scorm/${packageVersionId}/${"1".repeat(64)}`,
        "1".repeat(64),
      ],
    );

    await page.evaluate(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        document.documentElement.dataset.cspViolation = event.violatedDirective;
      });
    });
    await openAdminPage("SCORM modules");
    await expect(
      page.getByRole("heading", { name: "SCORM modules" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Upload module" }).click();
    await expect(page.getByLabel("SCORM ZIP")).toBeVisible();
    await page.getByRole("button", { name: "Upload and validate" }).click();
    await expect(page.getByText("Enter a module name.")).toBeVisible();
    await expect(page.getByText("Choose a SCORM ZIP to upload.")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    const moduleCard = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Automatic verification status",
      }),
    });
    await expect(moduleCard.getByText("Verifying")).toBeVisible();
    await expect(moduleCard.getByTestId("verification-spinner")).toBeVisible();

    await database.query(
      `update scorm_package_version
       set status = 'ready', "processedAt" = now(), "launchPath" = 'index.html'
       where id = $1`,
      [packageVersionId],
    );
    await database.query(
      `update learning_activity_version set "publishedAt" = now() where id = $1`,
      [packageVersionId],
    );
    await expect(
      moduleCard.getByText("Published v1", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(moduleCard.getByTestId("verification-spinner")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    await page.route("**/api/admin/scorm-packages?*", async (route) => {
      if (route.request().method() === "DELETE")
        await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await moduleCard.getByRole("button", { name: "Remove version" }).click();
    const removalDialog = page.getByRole("dialog", {
      name: "Remove SCORM version?",
    });
    await expect(removalDialog).toBeVisible();
    await expect(
      removalDialog.getByText(
        "Version 1 and its stored files will be permanently removed.",
      ),
    ).toBeVisible();
    await removalDialog.getByRole("button", { name: "Remove version" }).click();
    await expect(moduleCard.getByText("Removing")).toBeVisible();
    await expect(moduleCard.getByTestId("removal-spinner")).toBeVisible();
    await expect(moduleCard).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-csp-violation",
      /.+/,
    );
    const removedVersion = await database.query<{ count: number }>(
      `select count(*)::integer as count from scorm_package_version where id = $1`,
      [packageVersionId],
    );
    expect(removedVersion.rows[0]?.count).toBe(0);
    const removedPackage = await database.query<{ count: number }>(
      `select count(*)::integer as count from learning_activity where id = $1`,
      [packageId],
    );
    expect(removedPackage.rows[0]?.count).toBe(0);
  } finally {
    await cleanupScormPackageFixture(database, packageId, packageVersionId);
    await database.end();
  }
});

test("verified learners see entitlements and can redeem access", async ({
  page,
}, testInfo) => {
  const exercisesRedemption = testInfo.project.name === "chromium-mobile";
  await page.goto("/login");
  await page
    .getByLabel("Email address")
    .fill(
      exercisesRedemption ? "redeemer@codestudio.au" : "learner@codestudio.au",
    );
  await page
    .locator('input[name="password"]')
    .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "My learning" }),
  ).toBeVisible();
  if (!exercisesRedemption) {
    await expect(page.getByText("Leading through change")).toBeVisible();
    await expect(page.getByText("Responsible AI foundations")).toBeVisible();
    return;
  }

  const alreadyEnrolled =
    (await page.getByRole("link", { name: "Continue course" }).count()) > 0;
  if (!alreadyEnrolled) {
    await expect(
      page.getByRole("heading", {
        name: "Available through your organisation",
      }),
    ).toBeVisible();
    await expect(page.getByText("Psychological safety at work")).toBeVisible();
    await expect(page.getByText("Eligible for codestudio.au")).toBeVisible();
  }

  const code = page.getByRole("textbox", { name: "Access code *" });
  await page.getByRole("button", { name: "Redeem access code" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter the complete access code.")).toBeVisible();
  await code.fill("NOT-A-REAL-CODE");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Code not accepted")).toBeVisible();

  await code.fill("EXAMPLE-LEARN-2026-EXAMP7E26X");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Information release confirmation" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "I understand and agree to release this information to the access provider.",
    })
    .check();
  await page.getByRole("button", { name: "Agree and enrol" }).click();
  await expect(page.getByText("Access code applied")).toBeVisible();
  await expect(code).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Continue learning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue course" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Psychological safety at work" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.getByRole("link", { name: "Continue course" }).first().click();
  await expect(page).toHaveURL(/\/learn\/[A-Za-z0-9_-]+$/);
  await expect(
    page.getByRole("heading", { name: "Course program" }),
  ).toBeVisible();
  await expect(page.getByText("Learning modules")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
