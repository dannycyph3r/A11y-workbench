import type { AxeResults, NodeResult, Result } from "axe-core";
import { criterionIdFromAxeTag, getCriterion } from "@/lib/standards/wcag";
import { isCriterionInProfile, type ProfileId } from "@/lib/standards/profiles";
import { isLargeText } from "@/lib/contrast/contrast";
import { categoryFor, RULE_GUIDE } from "./rule-guide";
import type {
  ContrastEvidence,
  CriterionRef,
  Finding,
  FindingKind,
  FindingNode,
  FindingSource,
  Impact,
  SourceLocation,
} from "./types";

/** FNV-1a, enough to give findings short stable identifiers. */
export function fingerprint(...parts: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0000")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export const IMPACT_ORDER: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

export function normalizeImpact(raw: string | null | undefined, fallback: Impact = "moderate"): Impact {
  return raw === "critical" || raw === "serious" || raw === "moderate" || raw === "minor" ? raw : fallback;
}

/** Criteria that custom checks map to. */
export const CUSTOM_RULE_CRITERIA: Record<string, string[]> = {
  "awb-focus-not-visible": ["2.4.7"],
  "awb-outline-suppressed": ["2.4.7"],
  "awb-focus-obscured": ["2.4.11"],
  "awb-keyboard-trap": ["2.1.2"],
  "awb-clickable-not-focusable": ["2.1.1"],
  "awb-role-button-div": ["2.1.1", "4.1.2"],
  "awb-dragging-alternative": ["2.5.7"],
  "awb-paste-blocked": ["3.3.8"],
  "awb-password-autocomplete-off": ["3.3.8"],
  "awb-css-contrast": ["1.4.3"],
  "awb-figma-contrast": ["1.4.3"],
  "awb-figma-contrast-unresolved": ["1.4.3"],
  "awb-figma-target-size": ["2.5.8"],
  "awb-figma-small-text": [],
};

export function criteriaRefs(ids: string[], profile: ProfileId): CriterionRef[] {
  const refs: CriterionRef[] = [];
  for (const id of ids) {
    const c = getCriterion(id);
    if (!c) continue;
    refs.push({ id: c.id, title: c.title, level: c.level, inProfile: isCriterionInProfile(c.id, profile) });
  }
  return refs;
}

export function criteriaFromTags(tags: string[]): string[] {
  const ids = tags.map(criterionIdFromAxeTag).filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

const LOC_ATTR = /\sdata-awb-loc="(\d+)-(\d+)-(\d+)-(\d+)"/;

/** Reads (and strips) the source location the sandbox renderer stamped on each element. */
export function extractLocation(html: string): { html: string; location?: SourceLocation } {
  const m = LOC_ATTR.exec(html);
  if (!m) return { html };
  const [, start, end, line, column] = m.map(Number) as [number, number, number, number, number];
  return { html: html.replace(LOC_ATTR, ""), location: { start, end, line, column } };
}

/** Strips every instrumentation attribute so evidence shows only real markup. */
export function cleanHtml(html: string): string {
  return html.replace(/\sdata-awb-[a-z-]+="[^"]*"/g, "");
}

function parseFontSize(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const px = /\(([\d.]+)px\)/.exec(raw);
  if (px?.[1]) return parseFloat(px[1]);
  const pt = /([\d.]+)pt/.exec(raw);
  return pt?.[1] ? parseFloat(pt[1]) * (4 / 3) : undefined;
}

const UNRESOLVED_KEYS: Record<string, string> = {
  bgImage: "The background is an image, so the colour behind the text is unknown.",
  bgGradient: "The background is a gradient, so no single background colour applies.",
  imgNode: "The element contains an image.",
  bgOverlap: "Another element overlaps this text, so the background cannot be determined.",
  fgAlpha: "The text colour is translucent over an unresolved background.",
  elmPartiallyObscured: "The element is partly obscured by another element.",
  elmPartiallyObscuring: "The element partly covers other content.",
  outsideViewport: "The element is outside the tested viewport.",
  equalRatio: "Text and background resolve to the same colour, which usually means hidden or decorative text.",
  shortTextContent: "The text is too short to judge reliably (for example a single icon character).",
  nonBmp: "The text uses symbol or icon characters that may not be real text.",
  pseudoContent: "A pseudo-element sits behind the text.",
  colorParse: "A colour value could not be parsed.",
};

export function contrastEvidence(node: NodeResult): { evidence?: ContrastEvidence; unresolvedReason?: string } {
  const check = [...node.any, ...node.all, ...node.none].find((c) => c.id === "color-contrast");
  const data = (check?.data ?? {}) as Record<string, unknown>;
  const fontSizePx = parseFontSize(data.fontSize);
  const fontWeight = data.fontWeight === "bold" ? 700 : data.fontWeight === "normal" ? 400 : undefined;
  const expected = typeof data.expectedContrastRatio === "string" ? parseFloat(data.expectedContrastRatio) : undefined;
  const messageKey = typeof data.messageKey === "string" ? data.messageKey : undefined;
  const large = fontSizePx !== undefined ? isLargeText(fontSizePx, fontWeight ?? 400) : undefined;
  const evidence: ContrastEvidence = {
    foreground: typeof data.fgColor === "string" ? data.fgColor : undefined,
    background: typeof data.bgColor === "string" ? data.bgColor : undefined,
    ratio: typeof data.contrastRatio === "number" && data.contrastRatio > 0 ? data.contrastRatio : undefined,
    required: expected ?? (large ? 3 : 4.5),
    fontSizePx,
    fontWeight,
    isLargeText: large,
  };
  const unresolvedReason = messageKey ? UNRESOLVED_KEYS[messageKey] : undefined;
  return { evidence, unresolvedReason };
}

export interface NormalizeOptions {
  profile: ProfileId;
  /** Extra per-node evidence keyed by axe target selector (collected in page). */
  nodeExtras?: Record<string, Partial<FindingNode>>;
}

function nodeSelector(node: NodeResult): string {
  return node.target.map((t) => (Array.isArray(t) ? t.join(" >>> ") : String(t))).join(" > ");
}

/** Removes instrumentation attributes the engine may have used in a selector. */
export function cleanSelector(selector: string): string {
  return selector.replace(/\[data-awb-[a-z-]+="[^"]*"\]/g, "").trim() || selector;
}

function toFinding(rule: Result, node: NodeResult, bucket: "violation" | "incomplete", opts: NormalizeOptions): Finding {
  const guide = RULE_GUIDE[rule.id];
  const isBestPractice = rule.tags.includes("best-practice");
  const { html, location } = extractLocation(node.html);
  const rawSelector = nodeSelector(node);
  const selector = cleanSelector(rawSelector);

  let kind: FindingKind = bucket === "violation" ? "violation" : "needs-review";
  let contrast: ContrastEvidence | undefined;
  const evidence: string[] = [];
  if (rule.id === "color-contrast") {
    const { evidence: ev, unresolvedReason } = contrastEvidence(node);
    contrast = ev;
    if (bucket === "incomplete" && unresolvedReason) {
      kind = "inconclusive";
      if (contrast) contrast.note = unresolvedReason;
      evidence.push(unresolvedReason);
    }
  }
  if (node.failureSummary) {
    evidence.push(...node.failureSummary.split("\n").map((s) => s.trim()).filter(Boolean));
  }

  const extras = opts.nodeExtras?.[rawSelector];
  if (extras?.contrast && contrast) contrast = { ...contrast, ...extras.contrast };

  return {
    id: fingerprint(rule.id, location ? String(location.start) : selector),
    ruleId: rule.id,
    source: "axe" as FindingSource,
    category: categoryFor(rule.id, rule.tags),
    kind,
    title: guide?.title ?? rule.help,
    description: guide?.explanation ?? rule.description,
    impact: normalizeImpact(node.impact ?? rule.impact, kind === "violation" ? "serious" : "moderate"),
    criteria: criteriaRefs(criteriaFromTags(rule.tags), opts.profile),
    isBestPractice,
    helpUrl: rule.helpUrl,
    node: {
      selector,
      html: cleanHtml(html).slice(0, 800),
      failureSummary: node.failureSummary,
      location: location ?? extras?.location,
      contrast,
      evidence: [...new Set([...evidence, ...(extras?.evidence ?? [])])],
    },
    recommendation: guide?.recommendation ?? `Follow the rule guidance: ${rule.help}.`,
    fixConfidence: guide?.fixConfidence ?? "manual",
    verification: "unverified",
    manualReview: guide?.manualReview ?? [],
  };
}

export interface NormalizedAxe {
  findings: Finding[];
  criteriaExercised: string[];
  counts: { passes: number; violations: number; incomplete: number; inapplicable: number };
  rulesRun: number;
  engineVersion: string;
}

/** Converts raw axe-core results into workbench findings, one per affected node. */
export function normalizeAxe(results: AxeResults, opts: NormalizeOptions): NormalizedAxe {
  const findings: Finding[] = [];
  for (const rule of results.violations) for (const node of rule.nodes) findings.push(toFinding(rule, node, "violation", opts));
  for (const rule of results.incomplete) for (const node of rule.nodes) findings.push(toFinding(rule, node, "incomplete", opts));

  const exercised = new Set<string>();
  for (const bucket of [results.violations, results.incomplete, results.passes]) {
    for (const rule of bucket) for (const id of criteriaFromTags(rule.tags)) exercised.add(id);
  }
  const rulesRun = new Set(
    [...results.violations, ...results.incomplete, ...results.passes, ...results.inapplicable].map((r) => r.id),
  ).size;

  return {
    findings: dedupe(findings),
    criteriaExercised: [...exercised].sort(),
    counts: {
      passes: results.passes.length,
      violations: results.violations.length,
      incomplete: results.incomplete.length,
      inapplicable: results.inapplicable.length,
    },
    rulesRun,
    engineVersion: results.testEngine?.version ?? "unknown",
  };
}

/** Same rule on the same node can surface twice (violation and incomplete); keep the stronger. */
export function dedupe(findings: Finding[]): Finding[] {
  const rank: Record<FindingKind, number> = { violation: 0, heuristic: 1, "needs-review": 2, inconclusive: 3 };
  const map = new Map<string, Finding>();
  for (const f of findings) {
    const existing = map.get(f.id);
    if (!existing || rank[f.kind] < rank[existing.kind]) map.set(f.id, f);
  }
  return [...map.values()];
}

export function sortFindings(findings: Finding[]): Finding[] {
  const kindRank: Record<FindingKind, number> = { violation: 0, heuristic: 1, "needs-review": 2, inconclusive: 3 };
  return [...findings].sort(
    (a, b) =>
      kindRank[a.kind] - kindRank[b.kind] ||
      IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.node.location?.start ?? 0) - (b.node.location?.start ?? 0),
  );
}

/**
 * Copies source locations from a sandbox rescan of a page snapshot onto
 * the live page's findings, pairing them by rule and element markup.
 */
export function attachLocations(live: Finding[], snapshot: Finding[]): Finding[] {
  const pool = new Map<string, Finding[]>();
  const key = (f: Finding) => `${f.ruleId}\u0000${f.node.html.replace(/\s+/g, " ").trim()}`;
  for (const f of snapshot) {
    if (!f.node.location) continue;
    const list = pool.get(key(f)) ?? [];
    list.push(f);
    pool.set(key(f), list);
  }
  return live.map((f) => {
    if (f.node.location) return f;
    const match = pool.get(key(f))?.shift();
    if (!match) return f;
    const contrast = f.node.contrast && match.node.contrast?.colorSource && !f.node.contrast.colorSource
      ? { ...f.node.contrast, colorSource: match.node.contrast.colorSource }
      : f.node.contrast;
    return { ...f, node: { ...f.node, location: match.node.location, contrast } };
  });
}

export interface RawCustomResult {
  ruleId: string;
  kind: FindingKind;
  impact: Impact;
  selector: string;
  html: string;
  evidence: string[];
  location?: SourceLocation;
  contrast?: ContrastEvidence;
  source?: FindingSource;
}

/** Converts a custom-check result into a finding, using the same guide table. */
export function normalizeCustom(raw: RawCustomResult, profile: ProfileId): Finding {
  const guide = RULE_GUIDE[raw.ruleId];
  const extracted = extractLocation(raw.html);
  const location = raw.location ?? extracted.location;
  const selector = cleanSelector(raw.selector);
  return {
    id: fingerprint(raw.ruleId, location ? String(location.start) : selector),
    ruleId: raw.ruleId,
    source: raw.source ?? "custom",
    category: guide?.category ?? "other",
    kind: raw.kind,
    title: guide?.title ?? raw.ruleId,
    description: guide?.explanation ?? "",
    impact: raw.impact,
    criteria: criteriaRefs(CUSTOM_RULE_CRITERIA[raw.ruleId] ?? [], profile),
    isBestPractice: (CUSTOM_RULE_CRITERIA[raw.ruleId] ?? []).length === 0,
    node: {
      selector,
      html: cleanHtml(extracted.html).slice(0, 800),
      location,
      contrast: raw.contrast,
      evidence: raw.evidence,
    },
    recommendation: guide?.recommendation ?? "",
    fixConfidence: guide?.fixConfidence ?? "manual",
    verification: "unverified",
    manualReview: guide?.manualReview ?? [],
  };
}
