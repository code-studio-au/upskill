import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

test("public catalogue is responsive, accessible and CSP-hardened", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
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
  await page.getByRole("link", { name: "View course" }).click();
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
    await database.query(`delete from outbox_event where "aggregateId" = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from audit_event where "subjectId" = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from scorm_package_version where id = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from scorm_package where id = $1`, [
      packageId,
    ]);
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
    await database.query(`delete from outbox_event where "aggregateId" = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from audit_event where "subjectId" = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from scorm_package_version where id = $1`, [
      packageVersionId,
    ]);
    await database.query(`delete from scorm_package where id = $1`, [
      packageId,
    ]);
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
