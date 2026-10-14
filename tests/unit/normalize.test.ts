import { describe, expect, it } from "vitest";
import type { AxeResults, NodeResult, Result } from "axe-core";
import { attachLocations, cleanSelector, criteriaFromTags, dedupe, extractLocation, fingerprint, normalizeAxe, normalizeCustom, normalizeImpact, sortFindings } from "@/lib/findings/normalize";
import { criterionIdFromAxeTag } from "@/lib/standards/wcag";
import { criteriaForProfile } from "@/lib/standards/profiles";

function node(partial: Partial<NodeResult> & { html: string; target: string[] }): NodeResult {
  return { any: [], all: [], none: [], impact: null, failureSummary: undefined, ...partial } as unknown as NodeResult;
}

function rule(partial: Partial<Result> & { id: string; nodes: NodeResult[] }): Result {
  return { impact: "serious", tags: ["wcag2a"], description: "desc", help: "Help text", helpUrl: "https://example.org/rule", ...partial } as Result;
}

function results(p: Partial<AxeResults>): AxeResults {
  return { violations: [], incomplete: [], passes: [], inapplicable: [], testEngine: { name: "axe-core", version: "4.14.0" }, ...p } as unknown as AxeResults;
}

describe("criterion mapping", () => {
  it("parses axe criterion tags", () => {
    expect(criterionIdFromAxeTag("wcag143")).toBe("1.4.3");
    expect(criterionIdFromAxeTag("wcag1411")).toBe("1.4.11");
    expect(criterionIdFromAxeTag("wcag258")).toBe("2.5.8");
    expect(criterionIdFromAxeTag("wcag2aa")).toBeUndefined();
    expect(criterionIdFromAxeTag("wcag21aa")).toBeUndefined();
    expect(criteriaFromTags(["wcag2a", "wcag412", "wcag131", "best-practice"])).toEqual(["4.1.2", "1.3.1"]);
  });

  it("scopes profiles by version and exclusions", () => {
    const ids = (p: Parameters<typeof criteriaForProfile>[0]) => criteriaForProfile(p).map((c) => c.id);
    expect(ids("wcag22aa")).toContain("2.5.8");
    expect(ids("wcag22aa")).not.toContain("4.1.1"); // obsolete in 2.2
    expect(ids("wcag21aa")).toContain("4.1.1");
    expect(ids("wcag21aa")).not.toContain("2.4.11");
    expect(ids("wcag20aa")).not.toContain("1.4.11");
    expect(ids("aoda")).not.toContain("1.2.4");
    expect(ids("aoda")).not.toContain("1.2.5");
    expect(ids("aoda")).toContain("1.4.3");
    expect(ids("wcag22aa")).toHaveLength(55);
  });
});

describe("severity", () => {
  it("normalises impact and falls back sensibly", () => {
    expect(normalizeImpact("critical")).toBe("critical");
    expect(normalizeImpact(null)).toBe("moderate");
    expect(normalizeImpact(undefined, "serious")).toBe("serious");
    expect(normalizeImpact("weird")).toBe("moderate");
  });
});

describe("normalizeAxe", () => {
  const html = '<img data-awb-loc="10-40-3-5" src="a.png">';
  const out = normalizeAxe(
    results({
      violations: [rule({ id: "image-alt", impact: "critical", tags: ["cat.text-alternatives", "wcag2a", "wcag111"], nodes: [node({ html, target: ['img[data-awb-loc="10-40-3-5"]'], impact: "critical", failureSummary: "Fix any of the following:\n  Element has no alt attribute" })] })],
      incomplete: [
        rule({
          id: "color-contrast",
          impact: "serious",
          tags: ["cat.color", "wcag2aa", "wcag143"],
          nodes: [node({ html: "<p>x</p>", target: ["p"], any: [{ id: "color-contrast", data: { fgColor: "#777", bgColor: "#fff", messageKey: "bgImage", fontSize: "12.0pt (16px)", fontWeight: "normal", expectedContrastRatio: "4.5:1" } }] as never })],
        }),
      ],
      passes: [rule({ id: "document-title", tags: ["wcag2a", "wcag242"], nodes: [] })],
      inapplicable: [rule({ id: "video-caption", tags: ["wcag2a", "wcag122"], nodes: [] })],
    }),
    { profile: "wcag22aa" },
  );

  it("produces one finding per affected node with plain-language text", () => {
    expect(out.findings).toHaveLength(2);
    const img = out.findings.find((f) => f.ruleId === "image-alt")!;
    expect(img.kind).toBe("violation");
    expect(img.impact).toBe("critical");
    expect(img.category).toBe("images");
    expect(img.title).toBe("Image has no text alternative");
    expect(img.criteria).toEqual([{ id: "1.1.1", title: "Non-text Content", level: "A", inProfile: true }]);
    expect(img.fixConfidence).toBe("manual");
    expect(img.verification).toBe("unverified");
  });

  it("extracts and strips the source location stamp", () => {
    const img = out.findings.find((f) => f.ruleId === "image-alt")!;
    expect(img.node.location).toEqual({ start: 10, end: 40, line: 3, column: 5 });
    expect(img.node.html).toBe('<img src="a.png">');
    expect(img.node.selector).toBe("img");
    expect(img.node.evidence).toContain("Element has no alt attribute");
  });

  it("marks contrast over an image as inconclusive, not as a failure", () => {
    const cc = out.findings.find((f) => f.ruleId === "color-contrast")!;
    expect(cc.kind).toBe("inconclusive");
    expect(cc.node.contrast?.required).toBe(4.5);
    expect(cc.node.contrast?.ratio).toBeUndefined();
    expect(cc.node.evidence[0]).toMatch(/background is an image/);
  });

  it("records coverage and counts", () => {
    expect(out.criteriaExercised).toEqual(["1.1.1", "1.4.3", "2.4.2"]);
    expect(out.counts).toEqual({ passes: 1, violations: 1, incomplete: 1, inapplicable: 1 });
    expect(out.rulesRun).toBe(4);
    expect(out.engineVersion).toBe("4.14.0");
  });

  it("uses engine help text for rules without a guide entry", () => {
    const r = normalizeAxe(results({ violations: [rule({ id: "dlitem", tags: ["cat.structure", "wcag2a", "wcag131"], nodes: [node({ html: "<dt>", target: ["dt"] })] })] }), { profile: "wcag22aa" });
    expect(r.findings[0]!.title).toBe("Help text");
    expect(r.findings[0]!.category).toBe("structure");
    expect(r.findings[0]!.fixConfidence).toBe("manual");
  });
});

describe("helpers", () => {
  it("fingerprints deterministically", () => {
    expect(fingerprint("a", "b")).toBe(fingerprint("a", "b"));
    expect(fingerprint("a", "b")).not.toBe(fingerprint("a", "c"));
  });

  it("cleans instrumentation out of selectors and markup", () => {
    expect(cleanSelector('main > p[data-awb-loc="1-2-3-4"]')).toBe("main > p");
    expect(extractLocation("<p>").location).toBeUndefined();
  });

  it("keeps the stronger result when a node appears twice", () => {
    const base = normalizeCustom({ ruleId: "awb-focus-not-visible", kind: "needs-review", impact: "minor", selector: "a", html: "<a>", evidence: [] }, "wcag22aa");
    const stronger = { ...base, kind: "violation" as const };
    expect(dedupe([base, stronger])[0]!.kind).toBe("violation");
  });

  it("sorts violations before reviews, then by impact", () => {
    const mk = (kind: "violation" | "needs-review", impact: "critical" | "minor", sel: string) => normalizeCustom({ ruleId: "awb-dragging-alternative", kind, impact, selector: sel, html: "", evidence: [] }, "wcag22aa");
    const sorted = sortFindings([mk("needs-review", "critical", "a"), mk("violation", "minor", "b"), mk("violation", "critical", "c")]);
    expect(sorted.map((f) => f.node.selector)).toEqual(["c", "b", "a"]);
  });

  it("attaches snapshot locations to live findings by rule and markup", () => {
    const live = normalizeCustom({ ruleId: "awb-paste-blocked", kind: "heuristic", impact: "serious", selector: "#pw", html: '<input id="pw" onpaste="return false">', evidence: [] }, "wcag22aa");
    const snap = normalizeCustom({ ruleId: "awb-paste-blocked", kind: "heuristic", impact: "serious", selector: "#pw", html: '<input data-awb-loc="5-40-2-1" id="pw" onpaste="return false">', evidence: [] }, "wcag22aa");
    const [merged] = attachLocations([live], [snap]);
    expect(merged!.node.location).toEqual({ start: 5, end: 40, line: 2, column: 1 });
  });
});
