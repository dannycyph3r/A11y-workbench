import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("scan the test page, fix, verify and export a report", async ({ page }) => {
  await page.goto("/audit/new?method=fixture");
  await page.getByRole("button", { name: "Scan the test page" }).click();
  await expect(page).toHaveURL(/\/findings/, { timeout: 60_000 });
  await expect(page.getByText(/^Showing \d+ of \d+$/)).toBeVisible();
  const total = Number((await page.getByText(/^Showing \d+ of \d+$/).textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(20);
  // Live scan, not demo data.
  await expect(page.getByText("You are looking at demo data")).toHaveCount(0);

  // Review a finding and open its fix.
  await page.getByRole("button", { name: "Zooming is disabled" }).click();
  await expect(page.getByRole("heading", { name: "Zooming is disabled", level: 2 })).toBeVisible();
  await page.getByRole("link", { name: "Review the proposed fix" }).click();
  await expect(page.getByRole("heading", { name: "Remediation workspace", level: 1 })).toBeVisible();
  await expect(page.getByText(/High-confidence suggestion/)).toBeVisible();
  await expect(page.getByRole("region", { name: /Proposed change for Zooming is disabled/ })).toContainText("user-scalable=no");
  await page.getByRole("button", { name: "Accept fix" }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

  // A fix that needs the person's words.
  await page.getByRole("button", { name: /Image has no text alternative/ }).click();
  await expect(page.getByRole("button", { name: "Accept fix" })).toBeDisabled();
  await page.getByLabel("Alt text").fill("Clinic waiting room with chairs");
  await page.getByRole("button", { name: "Accept fix" }).click();

  // A contrast fix shows its measurements.
  await page.getByRole("button", { name: /Text contrast is below the minimum/ }).first().click();
  await expect(page.getByText(/Proposed: #[0-9a-f]{6} on #ffffff, 4\.\d\d:1/)).toBeVisible();
  await page.getByRole("button", { name: "Accept fix" }).click();

  // Reject one to prove it stays out.
  await page.getByRole("button", { name: /Positive tabindex changes the focus order/ }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Rejected", { exact: true }).first()).toBeVisible();

  await expect(page.getByText(/3 accepted fixes applied/)).toBeVisible();
  await page.getByRole("button", { name: "Verify accepted fixes" }).click();
  await expect(page.getByText(/Last rerun:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("dt", { hasText: "Resolved on rerun" }).locator("xpath=following-sibling::dd")).not.toHaveText("0");
  await page.getByRole("button", { name: /Zooming is disabled/ }).click();
  await expect(page.getByRole("article").getByText("Resolved on rerun")).toBeVisible();
  await page.getByRole("button", { name: /Positive tabindex/ }).click();
  await expect(page.getByRole("article").getByText("Still failing")).toBeVisible();

  // Patch download is a real unified diff.
  const patchDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .patch" }).click();
  const patch = readFileSync(await (await patchDownload).path(), "utf8");
  expect(patch).toContain("--- a/known-bad.html");
  expect(patch).toMatch(/^\+.*alt="Clinic waiting room with chairs"/m);
  expect(patch).not.toMatch(/^\+.*tabindex="0"/m);

  // Reports
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Report", level: 1 })).toBeVisible();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const report = JSON.parse(readFileSync(await (await jsonDownload).path(), "utf8"));
  expect(report.demo).toBe(false);
  expect(report.notice).toMatch(/not a certification/);
  expect(report.summary.accepted).toBe(3);
  expect(report.summary.resolved).toBeGreaterThanOrEqual(3);
  expect(report.engine.version).toMatch(/^\d+\.\d+/);
  expect(report.manualReviewChecklist.length).toBe(55);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = readFileSync(await (await csvDownload).path(), "utf8");
  expect(csv).toContain("id,rule,title,kind,impact");
  expect(csv).toContain("meta-viewport");
});

test("check pasted source and trace findings to lines", async ({ page }) => {
  await page.goto("/audit/new?method=source");
  await page.getByRole("button", { name: "React component" }).click();
  await expect(page.getByLabel("File name")).toHaveValue("BookingCard.tsx");
  await page.getByRole("button", { name: "Check source" }).click();
  await expect(page).toHaveURL(/\/findings/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Image has no text alternative" }).click();
  await expect(page.getByRole("article")).toContainText(/line \d+/);
  await page.locator("summary", { hasText: "Audit details and scope" }).click();
  await expect(page.getByText(/not compiled or executed/)).toBeVisible();
});

test("check a Figma JSON export in the browser", async ({ page }) => {
  await page.goto("/audit/new?method=figma");
  await expect(page.getByLabel("Figma file link")).toBeDisabled();
  await expect(page.getByText("Live import is not set up on this server")).toBeVisible();
  await page.getByRole("button", { name: "Load the sample design" }).click();
  await expect(page.getByText(/Selected: figma-sample.json/)).toBeVisible();
  await page.getByRole("button", { name: "Check design" }).click();
  await expect(page).toHaveURL(/\/findings/);
  await expect(page.getByRole("button", { name: "Text layer contrast is below the minimum" }).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Remediation workspace" }).click();
  await expect(page.getByText("This audit has no editable document")).toBeVisible();
});
