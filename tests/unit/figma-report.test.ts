import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeFigma, extractRoots, FigmaFormatError } from "@/lib/figma/analyze";
import { parseFigmaUrl } from "@/lib/figma/url";
import { buildReport, csvCell, NON_CERTIFICATION, reportToCsv } from "@/lib/report/report";
import { emptyRemediation, remediationReducer } from "@/lib/remediation/state";
import type { Audit } from "@/lib/findings/types";
import demo from "@/lib/demo/demo-audit.json";

const sample = JSON.parse(readFileSync("public/samples/figma-sample.json", "utf8")) as unknown;

describe("Figma URL parsing", () => {
  it.each([
    ["https://www.figma.com/design/AbCdEfGhIjKlMnOp/Booking?node-id=12-34", { fileKey: "AbCdEfGhIjKlMnOp", nodeIds: ["12:34"] }],
    ["https://figma.com/file/AbCdEfGhIjKlMnOp/Booking", { fileKey: "AbCdEfGhIjKlMnOp", nodeIds: [] }],
    ["https://www.figma.com/design/AbCdEfGhIjKlMnOp/branch/BrAnChKeY123456/Booking", { fileKey: "BrAnChKeY123456", nodeIds: [] }],
  ])("parses %s", (url, expected) => {
    expect(parseFigmaUrl(url)).toEqual(expected);
  });

  it.each(["https://evil.example/design/AbCdEfGhIjKlMnOp/x", "http://www.figma.com/design/AbCdEfGhIjKlMnOp/x", "https://www.figma.com/community/file/123", "not a url"])("rejects %s", (url) => {
    expect(parseFigmaUrl(url)).toBeNull();
  });
});

describe("design analysis", () => {
  const audit = analyzeFigma(sample, "wcag22aa", { fileName: "sample.json", via: "json" });
  const byRule = (id: string) => audit.findings.filter((f) => f.ruleId === id);

  it("measures solid text over solid layers", () => {
    const fails = byRule("awb-figma-contrast");
    expect(fails.map((f) => f.node.selector.split(" / ").pop())).toEqual(expect.arrayContaining(["Intro", "Slot label", "Disclaimer"]));
    const intro = fails.find((f) => f.node.selector.endsWith("Intro"))!;
    expect(intro.node.contrast?.ratio).toBeCloseTo(2.81, 1);
    expect(intro.criteria[0]!.id).toBe("1.4.3");
  });

  it("composites translucent text fills", () => {
    const d = byRule("awb-figma-contrast").find((f) => f.node.selector.endsWith("Disclaimer"))!;
    expect(d.node.contrast?.foreground).toBe("#9e9e9e");
  });

  it("reports gradients and partial overlaps as inconclusive instead of guessing", () => {
    const unresolved = byRule("awb-figma-contrast-unresolved");
    expect(unresolved.every((f) => f.kind === "inconclusive" && f.node.contrast?.ratio === undefined)).toBe(true);
    expect(unresolved.map((f) => f.node.evidence[0])).toEqual(expect.arrayContaining([expect.stringMatching(/gradient/), expect.stringMatching(/partly covers/)]));
  });

  it("passes readable text such as the button label", () => {
    expect(audit.findings.some((f) => f.node.selector.endsWith("Button label"))).toBe(false);
    expect(audit.counts.passes).toBe(4);
  });

  it("flags small interactive layers and small text separately", () => {
    expect(byRule("awb-figma-target-size")[0]!.kind).toBe("needs-review");
    expect(byRule("awb-figma-small-text")[0]!.isBestPractice).toBe(true);
  });

  it("separates design checks from what needs an implementation", () => {
    expect(audit.document).toBeUndefined();
    expect(audit.limitations.join(" ")).toMatch(/built implementation/);
  });

  it("rejects JSON that is not a Figma response", () => {
    expect(() => extractRoots({ foo: 1 })).toThrow(FigmaFormatError);
    expect(() => extractRoots("x")).toThrow(FigmaFormatError);
    expect(() => extractRoots({ document: { id: 1 } })).toThrow(FigmaFormatError);
    expect(extractRoots({ nodes: { "1:2": { document: { id: "1:2", name: "F", type: "FRAME" } } } }).roots).toHaveLength(1);
  });
});

describe("reports", () => {
  const audit = demo as unknown as Audit;

  it("states scope, engine and the non-certification notice", () => {
    const r = buildReport(audit, undefined, { defaultLang: "en" });
    expect(r.demo).toBe(true);
    expect(r.notice).toBe(NON_CERTIFICATION);
    expect(r.notice).toMatch(/not a certification/);
    expect(r.engine.name).toBe("axe-core");
    expect(r.standard.profile).toBe("WCAG 2.2 Level AA");
    expect(r.manualReviewChecklist).toHaveLength(55);
    expect(r.summary.total).toBe(audit.findings.length);
  });

  it("does not count accepted fixes as resolved without a rerun", () => {
    const first = audit.findings.find((f) => f.ruleId === "meta-viewport")!;
    let s = remediationReducer(emptyRemediation(), { type: "accept", findingId: first.id });
    let r = buildReport(audit, s, { defaultLang: "en" });
    const row = r.findings.find((f) => f.id === first.id)!;
    expect(row.fixDecision).toBe("accepted");
    expect(row.verification).toBe("unverified");
    expect(r.summary.resolved).toBe(0);
    s = remediationReducer(s, { type: "verified", result: { validation: { ok: true, errors: [] }, results: [{ findingId: first.id, status: "resolved", note: "gone" }], introduced: [], beforeCount: 1, afterCount: 0, engine: { version: "4" }, ranAt: "" } });
    r = buildReport(audit, s, { defaultLang: "en" });
    expect(r.summary.resolved).toBe(1);
    // A later change makes the rerun stale, so it is no longer reported.
    s = remediationReducer(s, { type: "reject", findingId: first.id });
    expect(buildReport(audit, s, { defaultLang: "en" }).summary.resolved).toBe(0);
  });

  it("escapes CSV and neutralises spreadsheet formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(["x", "y"])).toBe("x; y");
    const csv = reportToCsv(buildReport(audit, undefined, { defaultLang: "en" }));
    expect(csv).toMatch(/DEMO DATA/);
    expect(csv.split("\r\n").filter((l) => l.startsWith("id,rule,"))).toHaveLength(1);
  });
});
