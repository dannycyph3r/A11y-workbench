import { expect, test } from "@playwright/test";

test("URL form validates before sending anything", async ({ page }) => {
  await page.goto("/audit/new");
  await page.getByRole("button", { name: "Scan page" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter the address" })).toBeVisible();
  await expect(page.getByLabel("Page address")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Page address").fill("ftp://example.org");
  await page.getByRole("button", { name: "Scan page" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "https://" })).toBeVisible();
  await page.getByLabel("Page address").fill("https://example.org");
  await page.getByRole("button", { name: "Scan page" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "authorised" })).toBeVisible();
});

test("the server refuses local and private targets with a clear message", async ({ page }) => {
  await page.goto("/audit/new");
  await page.getByLabel("Page address").fill("http://localhost:3210/");
  await page.getByLabel("I own this site or am authorised to assess it.").check();
  await page.getByRole("button", { name: "Scan page" }).click();
  const err = page.getByRole("alert").filter({ hasText: "Local and internal host names cannot be scanned" });
  await expect(err).toBeVisible();
  await page.getByLabel("Page address").fill("http://169.254.169.254/latest/meta-data/");
  await page.getByRole("button", { name: "Scan page" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "link-local space" })).toBeVisible();
});

test("the API rejects malformed input without leaking internals", async ({ request }) => {
  const bad = await request.post("/api/scan/source", { data: { text: "" } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: { code: "invalid-input", message: "Paste or upload some source first." } });
  const notJson = await request.post("/api/scan/source", { data: "{nope", headers: { "content-type": "application/json" } });
  expect(notJson.status()).toBe(400);
  const unauth = await request.post("/api/scan/url", { data: { url: "https://example.org" } });
  expect((await unauth.json()).error.message).toMatch(/authorised/);
  const figma = await request.post("/api/figma/import", { data: { url: "https://www.figma.com/design/AbCdEfGhIjKlMnOp/x" } });
  expect(figma.status()).toBe(501);
  const ai = await request.post("/api/explain", { data: { finding: { ruleId: "x", title: "x", kind: "violation", impact: "minor", criteria: [], node: { html: "", evidence: [] } } } });
  expect(ai.status()).toBe(501);
  for (const res of [bad, notJson, unauth, figma, ai]) expect(await res.text()).not.toMatch(/at \w+ \(|node_modules|stack/i);
});

test("an empty source and a broken JSON export explain what to do", async ({ page }) => {
  await page.goto("/audit/new?method=source");
  await page.getByRole("button", { name: "Check source" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Paste some source" })).toBeVisible();

  await page.goto("/audit/new?method=figma");
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"hello": "world"}') });
  await page.getByRole("button", { name: "Check design" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not a Figma REST API response" })).toBeVisible();
});

test("empty states point to the next step", async ({ page }) => {
  for (const [route, text] of [["/findings", "No audit to show here yet"], ["/workspace", "No audit to show in the workspace"], ["/reports", "No audit to show in a report"]] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: text })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start an audit" })).toBeVisible();
  }
});
