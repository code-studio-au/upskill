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
  const stylesheet = await page
    .locator('link[rel="stylesheet"]')
    .first()
    .getAttribute("href");
  expect(stylesheet).toMatch(/^\/assets\//);
  const clientAssetResponse = await page.request.get(stylesheet ?? "");
  expect(clientAssetResponse.status()).toBe(200);
  expect(clientAssetResponse.headers()["content-type"]).toContain("text/css");
  expect(clientAssetResponse.headers()["cache-control"]).toContain("immutable");
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
});

test("learner dashboard requires a server-validated session", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to Upskill" }),
  ).toBeVisible();
});

test("verified learner sees enrolments and domain-matched access", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("learner@example.com");
  await page
    .locator('input[name="password"]')
    .fill(process.env.SEED_LEARNER_PASSWORD ?? "ci-only-learner-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "My learning" }),
  ).toBeVisible();
  await expect(page.getByText("Leading through change")).toBeVisible();
  await expect(page.getByText("Responsible AI foundations")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Available through your organisation",
    }),
  ).toBeVisible();
  await expect(page.getByText("Psychological safety at work")).toBeVisible();
  await expect(page.getByText("Eligible for example.com")).toBeVisible();
});
