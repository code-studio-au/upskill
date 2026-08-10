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
    await transaction.query(`delete from scorm_package where id = $1`, [
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
    await transaction.query(
      `delete from course_version_module where "courseVersionId" = $1`,
      [ids.courseVersion],
    );
    await transaction.query(`delete from scorm_package_version where id = $1`, [
      ids.packageVersion,
    ]);
    await transaction.query(`delete from scorm_package where id = $1`, [
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
        `delete from course_version_module where "courseVersionId" = any($1::text[])`,
        [versionIds],
      );
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

async function cleanupSurveyAuthoringFixture(
  database: Client,
  titles: Array<string>,
): Promise<void> {
  const surveys = await database.query<{ id: string }>(
    `select id from survey where title = any($1::text[])`,
    [titles],
  );
  const surveyIds = surveys.rows.map((survey) => survey.id);
  if (surveyIds.length === 0) return;
  await withPgAuditMaintenance(database, async (transaction) => {
    await transaction.query(
      `delete from outbox_event where "aggregateId" = any($1::text[])`,
      [surveyIds],
    );
    await transaction.query(
      `delete from audit_event where "subjectId" = any($1::text[])`,
      [surveyIds],
    );
    await transaction.query(
      `delete from survey_version where "surveyId" = any($1::text[])`,
      [surveyIds],
    );
    await transaction.query(`delete from survey where id = any($1::text[])`, [
      surveyIds,
    ]);
  });
}

async function cleanupResourceFixture(
  database: Client,
  title: string,
  knownVersionIds: Array<string>,
): Promise<void> {
  const resources = await database.query<{ id: string }>(
    `select id from learning_resource where title = $1`,
    [title],
  );
  const resourceIds = resources.rows.map((resource) => resource.id);
  const versions = await database.query<{ id: string }>(
    `select id from learning_resource_version where "resourceId" = any($1::text[])`,
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
    }
    await transaction.query(
      `delete from learning_resource where id = any($1::text[])`,
      [resourceIds],
    );
  });
}

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
    viewport: { width: 393, height: 852 },
  });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    "light",
  );
  await expect(
    page.getByRole("link", { name: "Courses", exact: true }),
  ).toBeVisible();
  const exploreCourses = page.getByRole("link", { name: "Explore courses" });
  await expect(exploreCourses).toBeVisible();
  await expect(exploreCourses).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await page.goto("/login");
  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeVisible();
  await expect(signIn).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const favicon = await page.request.get("/favicon.svg");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
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
  await page.locator('a[href="/courses/psychological-safety-at-work"]').click();
  await expect(
    page.getByRole("heading", { name: "Psychological safety at work" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What you will complete" }),
  ).toBeVisible();
  await expect(page.getByText(/1 CPD point/)).toBeVisible();
  await page.getByRole("button", { name: "Enrol in this course" }).click();
  await expect(page).toHaveURL(
    /\/login\?redirect=%2Fcourses%2Fpsychological-safety-at-work$/,
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to Upskill" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
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

  const learningOrigin = process.env.PLAYWRIGHT_LEARNING_PORT
    ? `http://127.0.0.1:${process.env.PLAYWRIGHT_LEARNING_PORT}`
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
});

test("learners run SCORM inside the course workspace", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
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
      `select id from "user" where email = 'admin@example.com'`,
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
      `insert into scorm_package (id, title) values ($1, $2)`,
      [ids.package, "E2E embedded package"],
    );
    await database.query(
      `insert into scorm_package_version
        (id, "packageId", version, status, standard, "contentPrefix", "launchPath", sha256, manifest, "sourceBytes", "publishedAt")
       values ($1, $2, 1, 'ready', 'scorm-1.2', 'e2e/scorm/player', 'index.html', $3, '{}'::jsonb, 1024, now())`,
      [ids.packageVersion, ids.package, "9".repeat(64)],
    );
    await database.query(
      `insert into course_version_module ("courseVersionId", position, "scormPackageVersionId") values ($1, 0, $2)`,
      [ids.courseVersion, ids.packageVersion],
    );
    await database.query(
      `insert into course_version_section (id, "courseVersionId", position, title, description) values ($1, $2, 0, $3, $4)`,
      [sectionId, ids.courseVersion, "Learning", "Complete the module."],
    );
    await database.query(
      `insert into course_version_item
        (id, "courseVersionId", "sectionId", position, kind, title, required, "durationMinutes", "modulePosition", "scormPackageVersionId")
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

    const learningOrigin = process.env.PLAYWRIGHT_LEARNING_PORT
      ? `http://127.0.0.1:${process.env.PLAYWRIGHT_LEARNING_PORT}`
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
    await page.getByLabel("Email address").fill("admin@example.com");
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
});

test("learners can end their authenticated session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@example.com");
  await page
    .locator('input[name="password"]')
    .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
});

test("platform administrators can inspect learner progress", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "The complete admin journey runs once; learner authentication remains cross-browser.",
  );

  await page.goto("/login?redirect=%2Fadmin");
  await page.getByLabel("Email address").fill("admin@example.com");
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
  await authoringDatabase.connect();
  try {
    await cleanupCourseAuthoringFixture(authoringDatabase, authoringSlug);
    await cleanupSurveyAuthoringFixture(authoringDatabase, surveyTitles);
    await cleanupResourceFixture(authoringDatabase, resourceTitle, [
      resourceVersionId,
    ]);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Courses", exact: true })
      .click();
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
    await expect(
      page.getByRole("heading", { name: "Learner roster" }),
    ).toBeVisible();
    await expect(page.getByText("learner@example.com")).toBeVisible();
    await expect(page.getByText(/Version 1 · Enrolled/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review learner progress" }),
    ).toBeVisible();
    await page.goto("/admin/courses");
    await page.getByRole("button", { name: "Create course" }).click();
    await page.getByLabel("Course title").fill("E2E editable course draft");
    await expect(page.getByLabel("URL slug")).toHaveValue(authoringSlug);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "E2E editable course draft",
    );
    await page.getByLabel("Title").fill("E2E edited course draft");
    await expect(page.getByLabel("Title")).toHaveValue(
      "E2E edited course draft",
    );
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section 1 title").fill("E2E edited section title");
    await expect(page.getByLabel("Section 1 title")).toHaveValue(
      "E2E edited section title",
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    await page
      .getByRole("main")
      .getByRole("link", { name: "Surveys", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Surveys", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create survey" }).click();
    await page.getByLabel("Survey title").fill(surveyTitles[0] ?? "");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.getByLabel("Title").fill(surveyTitles[1] ?? "");
    await page.getByRole("button", { name: "Add single choice" }).click();
    await page.getByLabel("Question 1").fill("Was this survey useful?");
    await page.getByLabel("Option 1").fill("Yes");
    await page.getByLabel("Option 2").fill("No");
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
      .getByRole("button", { name: "Add written response" })
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
      `insert into learning_resource (id, title) values ($1, $2)`,
      [resourceId, resourceTitle],
    );
    await authoringDatabase.query(
      `insert into learning_resource_version
        (id, "resourceId", version, "displayName", description, "objectKey", sha256, "sourceBytes", "mediaType")
       values ($1, $2, 1, 'e2e-resource.pdf', 'E2E resource description', $3, $4, 128, 'application/pdf')`,
      [
        resourceVersionId,
        resourceId,
        `resources/${resourceVersionId}/${"4".repeat(64)}.pdf`,
        "4".repeat(64),
      ],
    );
    await page
      .getByRole("main")
      .getByRole("link", { name: "Resources", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "PDF resources" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Upload resource" }).click();
    await expect(page.getByText("Enter a resource title.")).toBeVisible();
    await page.getByLabel("Resource title").fill("Missing document");
    await page.getByRole("button", { name: "Upload resource" }).click();
    await expect(page.getByText("Choose a PDF document.")).toBeVisible();
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
  } finally {
    await cleanupCourseAuthoringFixture(authoringDatabase, authoringSlug);
    await cleanupSurveyAuthoringFixture(authoringDatabase, surveyTitles);
    await cleanupResourceFixture(authoringDatabase, resourceTitle, [
      resourceVersionId,
    ]);
    await authoringDatabase.end();
  }

  await page.getByRole("link", { name: "Learners" }).click();
  await expect(
    page.getByRole("heading", { name: "Learners", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/\/admin\/learners\/?$/);
  await page.evaluate(() => {
    document.documentElement.dataset.clientNavigation = "preserved";
  });
  await page.getByLabel("Search learners").fill("learner@example.com");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Alex Learner")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Clear search filter: learner@example.com",
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.clientNavigation ?? null,
      ),
    )
    .toBe("preserved");
  await page.getByRole("link", { name: "View learner profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Learner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Course enrolments" }),
  ).toBeVisible();
  await expect(page.getByText("Leading through change")).toBeVisible();
  await page.getByRole("link", { name: "Review progress" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Overall course completion" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Module progress" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Corrections never alter the learner's original SCORM attempts.",
    ),
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
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");

  const database = new Client({ connectionString: process.env.DATABASE_URL });
  const packageId = "e2e_scorm_autorefresh_package";
  const packageVersionId = "e2e_scorm_autorefresh_version";
  await database.connect();
  try {
    await cleanupScormPackageFixture(database, packageId, packageVersionId);
    await database.query(
      `insert into scorm_package (id, title) values ($1, $2)`,
      [packageId, "Automatic verification status"],
    );
    await database.query(
      `insert into scorm_package_version
        (id, "packageId", version, status, standard, "contentPrefix", "launchPath", sha256, manifest, "sourceBytes")
       values ($1, $2, 1, 'processing', 'scorm-1.2', $3, 'pending.html', $4, '{}'::jsonb, 2048)`,
      [
        packageVersionId,
        packageId,
        `scorm/${packageVersionId}/${"1".repeat(64)}`,
        "1".repeat(64),
      ],
    );

    await page.evaluate(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        document.documentElement.dataset.cspViolation = event.violatedDirective;
      });
    });
    await page.getByRole("link", { name: "Modules" }).click();
    await expect(
      page.getByRole("heading", { name: "SCORM modules" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Upload module package" }),
    ).toBeVisible();
    await expect(page.getByLabel("SCORM ZIP")).toBeVisible();
    await page.getByRole("button", { name: "Upload and validate" }).click();
    await expect(page.getByText("Enter a module name.")).toBeVisible();
    await expect(page.getByText("Choose a SCORM ZIP to upload.")).toBeVisible();
    const moduleCard = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Automatic verification status",
      }),
    });
    await expect(moduleCard.getByText("Verifying")).toBeVisible();
    await expect(moduleCard.getByTestId("verification-spinner")).toBeVisible();

    await database.query(
      `update scorm_package_version
       set status = 'ready', "processedAt" = now(), "publishedAt" = now(), "launchPath" = 'index.html'
       where id = $1`,
      [packageVersionId],
    );
    await expect(moduleCard.getByText("Ready", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
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
      `select count(*)::integer as count from scorm_package where id = $1`,
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
    .fill(exercisesRedemption ? "redeemer@example.com" : "learner@example.com");
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
    await expect(page.getByText("Eligible for example.com")).toBeVisible();
  }

  const code = page.getByLabel("Access code");
  await page.getByRole("button", { name: "Apply access code" }).click();
  await expect(page.getByText("Enter the complete access code.")).toBeVisible();
  await code.fill("NOT-A-REAL-CODE");
  await page.getByRole("button", { name: "Apply access code" }).click();
  await expect(page.getByText("Code not accepted")).toBeVisible();

  await code.fill("EXAMPLE-LEARN-2026");
  await page.getByRole("button", { name: "Apply access code" }).click();
  await expect(
    page.getByText(/Access code applied|Already enrolled/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Continue learning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue course" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Psychological safety at work" }),
  ).toBeVisible();

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
