import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, openDemo } from "./helpers";

const ROUTES = ["/", "/audit/new", "/findings", "/workspace", "/reports", "/settings"];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`the app's own interface (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("every page passes axe in its empty state", async ({ page }) => {
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator("main h1")).toBeVisible();
        await expectNoAxeViolations(page, `${route} (empty, ${scheme})`);
      }
    });

    test("every page passes axe with an audit loaded and details open", async ({ page }) => {
      await openDemo(page);
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator("main h1")).toBeVisible();
        await expectNoAxeViolations(page, `${route} (demo, ${scheme})`);
      }
      await page.goto("/findings");
      await page.getByRole("button", { name: "Text contrast is below the minimum" }).first().click();
      await expect(page.getByRole("heading", { name: "Text contrast is below the minimum", level: 2 })).toBeVisible();
      await expectNoAxeViolations(page, `finding detail (${scheme})`);
      await page.goto("/workspace");
      await page.getByRole("button", { name: /Image has no text alternative/ }).click();
      await expect(page.getByLabel("Alt text")).toBeVisible();
      await expectNoAxeViolations(page, `workspace input form (${scheme})`);
      for (const tab of ["Source code", "Figma design", "Test page"]) {
        await page.goto("/audit/new");
        await page.getByRole("tab", { name: tab }).click();
        await expectNoAxeViolations(page, `new audit ${tab} tab (${scheme})`);
      }
    });
  });
}

test("narrow screens keep the interface accessible and free of horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openDemo(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page, `${route} at 360px`);
  }
});

test("the skip link is the first tab stop and moves focus to the content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("client navigation moves focus to the new page heading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeFocused();
});

test("filters and tabs work from the keyboard", async ({ page }) => {
  await openDemo(page);
  await page.goto("/audit/new");
  await page.getByRole("tab", { name: "Website URL" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Source code" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Source code" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Test page" })).toBeFocused();

  await page.goto("/findings");
  await page.getByLabel("Impact").selectOption("critical");
  await expect(page.getByText(/Showing 4 of 29/)).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText(/Showing 29 of 29/)).toBeVisible();
});
