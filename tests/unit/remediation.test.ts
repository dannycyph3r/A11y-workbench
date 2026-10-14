import { describe, expect, it } from "vitest";
import { normalizeCustom } from "@/lib/findings/normalize";
import { lineIndex, parseStartTagAt } from "@/lib/source/tags";
import type { ContrastEvidence, Finding, RemediationDocument } from "@/lib/findings/types";
import { applyEdits, EditConflictError, editsConflict, mapOffset } from "@/lib/remediation/edits";
import { composeAccepted, proposeFix } from "@/lib/remediation/engine";
import { emptyRemediation, remediationReducer } from "@/lib/remediation/state";
import { buildDiffRows, diffStats, unifiedPatch } from "@/lib/remediation/diff";
import { applyPatch } from "diff";

const settings = { defaultLang: "en" };

function doc(text: string, dialect: RemediationDocument["dialect"] = "html"): RemediationDocument {
  return { dialect, text, fileName: dialect === "jsx" ? "C.tsx" : dialect === "css" ? "s.css" : "p.html", origin: "user-source" };
}

/** Builds a finding that points at the start tag containing `needle`. */
function findingAt(d: RemediationDocument, ruleId: string, needle: string, contrast?: ContrastEvidence): Finding {
  const start = d.text.lastIndexOf("<", d.text.indexOf(needle) + 1);
  const tag = parseStartTagAt(d.text, start, d.dialect === "jsx" ? "jsx" : "html")!;
  const { line, column } = lineIndex(d.text)(start);
  return normalizeCustom({ ruleId, kind: "violation", impact: "serious", selector: tag.name, html: d.text.slice(tag.start, tag.end), evidence: [], location: { start, end: tag.end, line, column }, contrast }, "wcag22aa");
}

const patched = (d: RemediationDocument, f: Finding, inputs: Record<string, string> = {}) => {
  const fix = proposeFix(f, d, inputs, settings)!;
  return { fix, text: applyEdits(d.text, fix.edits) };
};

describe("text edits", () => {
  it("applies non-overlapping edits in order and dedupes identical ones", () => {
    const e1 = { start: 0, end: 1, replacement: "X" };
    expect(applyEdits("abc", [{ start: 2, end: 3, replacement: "Z" }, e1, e1])).toBe("XbZ");
  });

  it("refuses overlapping edits instead of dropping one", () => {
    expect(() => applyEdits("abcdef", [{ start: 0, end: 3, replacement: "x" }, { start: 2, end: 4, replacement: "y" }])).toThrow(EditConflictError);
    expect(editsConflict({ start: 2, end: 2, replacement: "a" }, { start: 2, end: 2, replacement: "b" })).toBe(true);
    expect(editsConflict({ start: 2, end: 2, replacement: "a" }, { start: 2, end: 5, replacement: "b" })).toBe(false);
  });

  it("maps offsets through edits", () => {
    const edits = [{ start: 0, end: 0, replacement: "<label>L</label>\n" }, { start: 10, end: 12, replacement: "" }];
    expect(mapOffset(0, edits)).toBe(17); // insertion before the element pushes it forward
    expect(mapOffset(20, edits)).toBe(35);
    expect(mapOffset(11, edits)).toBe(27); // inside a replaced range maps to its start
  });
});

describe("deterministic fixers", () => {
  it("unblocks zoom in the viewport meta tag (high confidence)", () => {
    const d = doc(`<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`);
    const { fix, text } = patched(d, findingAt(d, "meta-viewport", "<meta"));
    expect(fix.confidence).toBe("high");
    expect(text).toBe(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
  });

  it("adds lang from settings and lets the person override it", () => {
    const d = doc(`<!DOCTYPE html>\n<html>\n<head></head></html>`);
    const f = findingAt(d, "html-has-lang", "<html");
    expect(patched(d, f).text).toContain(`<html lang="en">`);
    expect(patched(d, f, { lang: "fr-CA" }).text).toContain(`<html lang="fr-CA">`);
    expect(patched(d, f).fix.confidence).toBe("review");
  });

  it("never invents alt text: no edit until the person writes it", () => {
    const d = doc(`<img src="room.jpg">`);
    const f = findingAt(d, "image-alt", "<img");
    const empty = proposeFix(f, d, {}, settings)!;
    expect(empty.needsInput).toBe(true);
    expect(empty.edits).toEqual([]);
    expect(patched(d, f, { alt: 'Waiting room with "blue" chairs' }).text).toBe(`<img src="room.jpg" alt="Waiting room with &quot;blue&quot; chairs">`);
    expect(patched(d, f, { decorative: "true" }).text).toBe(`<img src="room.jpg" alt="">`);
  });

  it("adds a native label and generates a unique id", () => {
    const d = doc(`<div id="health-card-number"></div>\n<input type="text">`);
    const { text } = patched(d, findingAt(d, "label", "<input"), { label: "Health card number" });
    expect(text).toContain(`<label for="health-card-number-2">Health card number</label>\n<input type="text" id="health-card-number-2">`);
  });

  it("uses JSX attribute names in JSX", () => {
    const d = doc(`export const A = () => <input className="x" />;`, "jsx");
    const { text } = patched(d, findingAt(d, "label", "<input"), { label: "Search {terms}" });
    expect(text).toContain(`<label htmlFor="search-terms">Search {"{"}terms{"}"}</label>`);
    expect(text).toContain(`<input className="x" id="search-terms" />`);
  });

  it("corrects misspelled ARIA attributes and removes unknown ones", () => {
    const d = doc(`<p aria-labeledby="t" aria-zzzzzzzz="1">x</p>`);
    const { text } = patched(d, findingAt(d, "aria-valid-attr", "<p"));
    expect(text).toBe(`<p aria-labelledby="t">x</p>`);
  });

  it("replaces a div button with a native button, end tag included", () => {
    const d = doc(`<div role="button" class="cta" tabindex="0">Book <b>now</b></div><div>after</div>`);
    const { text, fix } = patched(d, findingAt(d, "awb-role-button-div", 'role="button"'));
    expect(text).toBe(`<button type="button" class="cta">Book <b>now</b></button><div>after</div>`);
    expect(fix.confidence).toBe("review");
  });

  it("will not swap an element that contains interactive content", () => {
    const d = doc(`<div role="button"><a href="/x">x</a></div>`);
    expect(proposeFix(findingAt(d, "awb-role-button-div", "role"), d, {}, settings)).toBeNull();
  });

  it("removes a paste-blocking handler", () => {
    const d = doc(`<input type="password" onpaste="return false" autocomplete="current-password">`);
    expect(patched(d, findingAt(d, "awb-paste-blocked", "<input")).text).toBe(`<input type="password" autocomplete="current-password">`);
  });

  it("fixes a contrast failure in the stylesheet rule the browser reported", () => {
    const d = doc(`<style>.muted { color: #9a9a9a; }</style><p class="muted">x</p>`);
    const f = findingAt(d, "color-contrast", "<p", { foreground: "#9a9a9a", background: "#ffffff", ratio: 2.81, required: 4.5, colorSource: { kind: "rule", selector: ".muted", value: "rgb(154, 154, 154)" } });
    const { fix, text } = patched(d, f);
    expect(fix.color!.ratioAfter).toBeGreaterThanOrEqual(4.5);
    expect(text).toBe(`<style>.muted { color: ${fix.color!.to}; }</style><p class="muted">x</p>`);
    expect(fix.warnings.join(" ")).toMatch(/may style other elements/);
  });

  it("fixes contrast in an inline style and in a JSX style object", () => {
    const h = doc(`<span style="font-size: 14px; color: #7fb3d5;">x</span>`);
    const hf = findingAt(h, "color-contrast", "<span", { foreground: "#7fb3d5", background: "#ffffff", required: 4.5, colorSource: { kind: "inline", value: "x" } });
    expect(patched(h, hf).text).toMatch(/color: #[0-9a-f]{6};/);
    const j = doc(`const A = () => <p style={{ color: "#9aa5b1", fontSize: 14 }}>x</p>;`, "jsx");
    const jf = findingAt(j, "color-contrast", "<p", { foreground: "#9aa5b1", background: "#ffffff", required: 4.5, colorSource: { kind: "inline", value: "x" } });
    const out = patched(j, jf).text;
    expect(out).toMatch(/style=\{\{ color: "#[0-9a-f]{6}", fontSize: 14 \}\}/);
  });

  it("offers a value but no patch when the colour is declared elsewhere", () => {
    const d = doc(`<p class="external">x</p>`);
    const f = findingAt(d, "color-contrast", "<p", { foreground: "#999999", background: "#ffffff", required: 4.5, colorSource: { kind: "rule", selector: ".external", value: "x" } });
    const fix = proposeFix(f, d, {}, settings)!;
    expect(fix.edits).toEqual([]);
    expect(fix.confidence).toBe("manual");
    expect(fix.color?.to).toMatch(/^#/);
  });

  it("removes outline suppression from a static CSS rule", () => {
    const d = doc(`a { color: blue; }\n*:focus {\n  outline: none;\n}\n`, "css");
    const rule = d.text.indexOf("*:focus");
    const f = normalizeCustom({ ruleId: "awb-outline-suppressed", kind: "heuristic", impact: "serious", selector: "*:focus", html: "", evidence: [], source: "static-css", location: { start: rule, end: d.text.length - 1, line: 2, column: 1 } }, "wcag22aa");
    expect(patched(d, f).text).toBe(`a { color: blue; }\n*:focus {\n}\n`);
  });

  it("returns null for rules that need a person", () => {
    const d = doc(`<h3>x</h3>`);
    expect(proposeFix(findingAt(d, "heading-order", "<h3"), d, {}, settings)).toBeNull();
    expect(proposeFix(findingAt(d, "heading-order", "<h3"), undefined, {}, settings)).toBeNull();
  });

  it("returns null when the location no longer lines up with a tag", () => {
    const d = doc(`<img src="a">`);
    const f = findingAt(d, "image-alt", "<img");
    f.node.location = { ...f.node.location!, end: 3 };
    expect(proposeFix(f, d, { alt: "x" }, settings)).toBeNull();
  });
});

describe("accepting and rejecting", () => {
  it("tracks decisions, order and staleness", () => {
    let s = emptyRemediation();
    s = remediationReducer(s, { type: "accept", findingId: "a" });
    s = remediationReducer(s, { type: "accept", findingId: "b" });
    expect(s.acceptedOrder).toEqual(["a", "b"]);
    s = remediationReducer(s, { type: "verified", result: { validation: { ok: true, errors: [] }, results: [], introduced: [], beforeCount: 1, afterCount: 0, engine: { version: "x" }, ranAt: "" } });
    expect(s.verification?.stale).toBe(false);
    s = remediationReducer(s, { type: "reject", findingId: "a" });
    expect(s.fixes.a!.decision).toBe("rejected");
    expect(s.acceptedOrder).toEqual(["b"]);
    expect(s.verification?.stale).toBe(true);
    s = remediationReducer(s, { type: "input", findingId: "c", key: "alt", value: "x" });
    expect(s.fixes.c).toEqual({ decision: "proposed", inputs: { alt: "x" } });
    s = remediationReducer(s, { type: "reset", findingId: "c" });
    expect(s.fixes.c).toEqual({ decision: "proposed", inputs: {} });
    expect(remediationReducer(s, { type: "resetAll" })).toEqual(emptyRemediation());
  });

  it("composes accepted fixes, merging shared edits and reporting conflicts", () => {
    const d = doc(`<style>.m { color: #999999; }</style><p class="m">a</p><p class="m">b</p><img src="x">`);
    const ev = { foreground: "#999999", background: "#ffffff", required: 4.5, colorSource: { kind: "rule" as const, selector: ".m", value: "x" } };
    const p1 = proposeFix(findingAt(d, "color-contrast", `<p class="m">a`, ev), d, {}, settings)!;
    const p2 = proposeFix(findingAt(d, "color-contrast", `<p class="m">b`, ev), d, {}, settings)!;
    const img = proposeFix(findingAt(d, "image-alt", "<img"), d, { alt: "Logo" }, settings)!;
    const clash = { ...img, findingId: "other", edits: [{ ...img.edits[0]!, replacement: ` alt="Different"` }] };
    const out = composeAccepted(d, [p1, p2, img, clash]);
    expect(out.applied).toHaveLength(3);
    expect(out.conflicts).toEqual([{ findingId: "other", withFindingId: img.findingId }]);
    expect(out.text.match(/color: #/g)).toHaveLength(1);
    expect(out.text).toContain(`<img src="x" alt="Logo">`);
    expect(d.text).toContain("#999999"); // original untouched
  });

  it("skips fixes that still need input", () => {
    const d = doc(`<img src="x">`);
    const pending = proposeFix(findingAt(d, "image-alt", "<img"), d, {}, settings)!;
    expect(composeAccepted(d, [pending]).applied).toEqual([]);
  });
});

describe("diffs and patches", () => {
  const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
  const after = "a\nb\nc\nd\nE!\nf\ng\nh\ni\nj\nk\n";

  it("builds side-by-side rows with folding and inline change marks", () => {
    const rows = buildDiffRows(before, after, 1);
    expect(diffStats(rows)).toEqual({ added: 2, removed: 1 });
    const changed = rows.find((r) => r.kind === "change" && r.left && r.right);
    expect(changed).toMatchObject({ left: { lineNo: 5, changed: "e" }, right: { lineNo: 5, changed: "E!" } });
    expect(rows.some((r) => r.kind === "fold")).toBe(true);
  });

  it("windows very long lines around the change", () => {
    const long = "x".repeat(2000);
    const rows = buildDiffRows(`${long}A${long}`, `${long}B${long}`);
    const row = rows.find((r) => r.kind === "change")!;
    if (row.kind !== "change") throw new Error();
    expect(row.left!.changed).toBe("A");
    expect(row.left!.truncatedStart && row.left!.truncatedEnd).toBe(true);
    expect(row.left!.before.length).toBeLessThan(200);
  });

  it("produces a unified patch that applies cleanly", () => {
    const patch = unifiedPatch("page.html", before, after);
    expect(patch).toContain("--- a/page.html");
    expect(patch).toContain("+++ b/page.html");
    expect(applyPatch(before, patch)).toBe(after);
  });
});
