import "server-only";
import type { Page } from "playwright";
import type { AxeResults } from "axe-core";
import { PROFILES, type ProfileId } from "@/lib/standards/profiles";
import { dedupe, normalizeAxe, normalizeCustom, sortFindings, type RawCustomResult } from "@/lib/findings/normalize";
import type { Finding, FindingNode } from "@/lib/findings/types";
import { axeSource } from "./browser";
import { COLOR_SOURCES, PAGE_FACTS, PROBE_FOCUS, RECORD_BASELINE } from "./page-scripts";

/** Document-level rules that do not apply to a component or fragment. */
export const DOCUMENT_LEVEL_RULES = [
  "document-title",
  "html-has-lang",
  "html-lang-valid",
  "landmark-one-main",
  "page-has-heading-one",
  "region",
  "bypass",
  "meta-viewport",
];

export interface PageAuditOptions {
  profile: ProfileId;
  includeBestPractice: boolean;
  isFragment: boolean;
  keyboardWalk: boolean;
  maxTabStops?: number;
  signal?: AbortSignal;
}

export interface PageAuditResult {
  findings: Finding[];
  criteriaExercised: string[];
  counts: { passes: number; violations: number; incomplete: number; inapplicable: number };
  rulesRun: number;
  engineVersion: string;
  warnings: string[];
  tabStops: number;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

export async function auditPage(page: Page, opts: PageAuditOptions): Promise<PageAuditResult> {
  const warnings: string[] = [];
  const profile = PROFILES[opts.profile];
  const tags = [...profile.axeTags, ...(opts.includeBestPractice ? ["best-practice"] : [])];

  checkAbort(opts.signal);
  // Inject axe by evaluation so it works even when page scripts are disabled.
  await page.evaluate(axeSource());
  const disabledRules = opts.isFragment ? DOCUMENT_LEVEL_RULES : [];
  // Rules that ship disabled in axe-core but map to an A or AA criterion in scope.
  const optIn = ["aria-roledescription", ...(profile.axeTags.includes("wcag22aa") ? ["target-size"] : [])];
  const axeResults = (await page.evaluate(
    `window.axe.run(document, ${JSON.stringify({
      runOnly: { type: "tag", values: tags },
      rules: {
        ...Object.fromEntries(optIn.map((r) => [r, { enabled: true }])),
        ...Object.fromEntries(disabledRules.map((r) => [r, { enabled: false }])),
      },
      resultTypes: ["violations", "incomplete"],
      iframes: false,
      elementRef: false,
    })})`,
  )) as AxeResults;

  checkAbort(opts.signal);
  // Locate where failing text colours are declared, for the contrast fixer.
  // Only single-level targets (no iframe or shadow boundary) can be queried directly.
  const contrastSelectors = [...axeResults.violations, ...axeResults.incomplete]
    .filter((r) => r.id === "color-contrast")
    .flatMap((r) => r.nodes.filter((n) => n.target.length === 1 && typeof n.target[0] === "string").map((n) => String(n.target[0])));
  const sources = contrastSelectors.length
    ? ((await page.evaluate(`(${COLOR_SOURCES})(${JSON.stringify(contrastSelectors)})`)) as Record<
        string,
        { kind: "inline" | "rule"; selector?: string; value: string }
      >)
    : {};
  // Extras carry only the colour source; the ratio and threshold stay as the engine measured them.
  const nodeExtras: Record<string, Partial<FindingNode>> = {};
  for (const sel of contrastSelectors) {
    const src = sources[sel];
    if (src) nodeExtras[sel] = { contrast: { colorSource: src } as FindingNode["contrast"] };
  }

  const normalized = normalizeAxe(axeResults, { profile: opts.profile, nodeExtras });

  checkAbort(opts.signal);
  const facts = (await page.evaluate(PAGE_FACTS)) as { results: RawCustomResult[]; warnings: string[] };
  warnings.push(...facts.warnings);
  const custom: Finding[] = facts.results.map((r) => normalizeCustom(r, opts.profile));

  let tabStops = 0;
  if (opts.keyboardWalk) {
    const walk = await keyboardWalk(page, opts);
    tabStops = walk.tabStops;
    custom.push(...walk.results.map((r) => normalizeCustom(r, opts.profile)));
  }

  return {
    findings: sortFindings(dedupe([...normalized.findings, ...custom])),
    criteriaExercised: normalized.criteriaExercised,
    counts: normalized.counts,
    rulesRun: normalized.rulesRun,
    engineVersion: normalized.engineVersion,
    warnings,
    tabStops,
  };
}

interface Probe {
  atBody: boolean;
  segmented?: boolean;
  selector?: string;
  html?: string;
  outlineVisible?: boolean;
  changed?: boolean;
  hadBaseline?: boolean;
  obscured?: boolean;
  coverSelector?: string;
}

/** Tabs through the page with a real keyboard and records what focus does. */
async function keyboardWalk(page: Page, opts: PageAuditOptions): Promise<{ results: RawCustomResult[]; tabStops: number }> {
  const results: RawCustomResult[] = [];
  const max = opts.maxTabStops ?? 60;
  await page.evaluate(RECORD_BASELINE);
  await page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()");
  const seen = new Set<string>();
  let first: string | undefined;
  let last: string | undefined;
  let repeats = 0;
  let stops = 0;

  for (let i = 0; i < max; i++) {
    checkAbort(opts.signal);
    await page.keyboard.press("Tab");
    const p = (await page.evaluate(PROBE_FOCUS)) as Probe;
    if (p.atBody || !p.selector) {
      if (stops > 0) break;
      continue;
    }
    if (p.selector === last) {
      repeats++;
      // Date and time inputs move focus between their own segments, so allow more presses.
      if (repeats === (p.segmented ? 8 : 2)) {
        results.push({
          ruleId: "awb-keyboard-trap",
          kind: "heuristic",
          impact: "critical",
          selector: p.selector,
          html: p.html ?? "",
          evidence: [`${repeats + 1} Tab presses in a row left focus on this element.`],
        });
        break;
      }
      continue;
    }
    repeats = 0;
    last = p.selector;
    if (p.selector === first) break; // wrapped around
    first ??= p.selector;
    if (seen.has(p.selector)) break;
    seen.add(p.selector);
    stops++;

    if (p.hadBaseline && !p.outlineVisible && !p.changed) {
      results.push({
        ruleId: "awb-focus-not-visible",
        kind: "heuristic",
        impact: "serious",
        selector: p.selector,
        html: p.html ?? "",
        evidence: [
          `Reached by Tab press ${stops}.`,
          "When focused, it shows no outline and none of its border, shadow, background, colour or underline styles change.",
        ],
      });
    }
    if (p.obscured) {
      results.push({
        ruleId: "awb-focus-obscured",
        kind: "heuristic",
        impact: "serious",
        selector: p.selector,
        html: p.html ?? "",
        evidence: [`Reached by Tab press ${stops}.`, `Fully covered by fixed or sticky content: ${p.coverSelector}.`],
      });
    }
  }
  return { results, tabStops: stops };
}
