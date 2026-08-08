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
});
