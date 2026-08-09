import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("validated catalogue search remains navigable", async ({ page }) => {
  await page.goto("/courses?q=safety&topic=safety&page=1");
  await expect(
    page.getByRole("heading", { name: "Find your next skill" }),
  ).toBeVisible();
  await expect(page.getByText("Psychological safety at work")).toBeVisible();
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
  await page.getByLabel("Search learners").fill("learner@example.com");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Alex Learner")).toBeVisible();
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
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
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
