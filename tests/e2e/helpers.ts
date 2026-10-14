import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

/** Runs axe-core (WCAG 2.2 A and AA plus best practice) against the app's own UI. */
export async function expectNoAxeViolations(page: Page, label: string) {
  await page.evaluate(AXE);
  const violations = (await page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa","best-practice"] }, rules: { "target-size": { enabled: true } } }).then(r => r.violations)`)) as AxeViolation[];
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(violations, `${label}\n${summary}`).toEqual([]);
}

export async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the demo audit" }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
}
