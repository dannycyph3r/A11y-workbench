import { describe, expect, it } from "vitest";
import { findMatchingEnd, getAttr, instrumentHtml, isFullDocument, lineIndex, parseStartTagAt, scanHtml } from "@/lib/source/tags";
import { checkCss, parseCss, rulesFromHtml } from "@/lib/source/css";
import { inferDialect, SourceScanSchema, UrlScanSchema, VerifySchema } from "@/lib/api/schemas";

describe("tag scanner", () => {
  it("parses attributes with exact ranges", () => {
    const text = `<img src="a.png" alt='x > y' hidden data-n=3>`;
    const tag = parseStartTagAt(text, 0)!;
    expect(tag.name).toBe("img");
    expect(tag.end).toBe(text.length);
    expect(tag.attrs.map((a) => a.name)).toEqual(["src", "alt", "hidden", "data-n"]);
    const alt = getAttr(tag, "ALT")!;
    expect(text.slice(alt.valueStart, alt.valueEnd)).toBe("x > y");
    expect(getAttr(tag, "hidden")!.value).toBeNull();
    expect(text.slice(tag.insertAt, tag.end)).toBe(">");
  });

  it("handles JSX braces, spreads and self-closing tags", () => {
    const text = `<button onClick={() => a > b ? "}" : 1} {...rest} disabled />`;
    const tag = parseStartTagAt(text, 0, "jsx")!;
    expect(tag.selfClosing).toBe(true);
    expect(tag.end).toBe(text.length);
    expect(tag.spreads).toHaveLength(1);
    expect(tag.attrs.map((a) => a.name)).toEqual(["onClick", "disabled"]);
    expect(text.slice(tag.insertAt, tag.end)).toBe(" />"); // insert before the trailing space
  });

  it("skips comments and raw-text bodies", () => {
    const html = `<!-- <a href="x"> --><style>p > a { color: red }</style><script>if (a < b) {}</script><p>hi</p>`;
    const { starts } = scanHtml(html);
    expect(starts.map((s) => s.name)).toEqual(["style", "script", "p"]);
  });

  it("finds the matching end tag across nesting", () => {
    const html = `<div id="outer"><div>inner</div><span></span></div><div></div>`;
    const tag = parseStartTagAt(html, 0)!;
    const end = findMatchingEnd(html, tag)!;
    expect(end.start).toBe(html.indexOf("</div><div></div>"));
  });

  it("stamps every element with its original location", () => {
    const html = `<p>\n  <a href="/">x</a>\n</p>`;
    const out = instrumentHtml(html);
    expect(out).toContain(`<p data-awb-loc="0-3-1-1">`);
    const aStart = html.indexOf("<a");
    expect(out).toContain(`<a data-awb-loc="${aStart}-${html.indexOf(">x") + 1}-2-3" href="/">`);
  });

  it("computes 1-based lines and columns", () => {
    const pos = lineIndex("ab\ncd\n\nx");
    expect(pos(0)).toEqual({ line: 1, column: 1 });
    expect(pos(4)).toEqual({ line: 2, column: 2 });
    expect(pos(7)).toEqual({ line: 4, column: 1 });
  });

  it("tells documents from fragments", () => {
    expect(isFullDocument("<!DOCTYPE html><p>")).toBe(true);
    expect(isFullDocument("<html lang=en>")).toBe(true);
    expect(isFullDocument("<form></form>")).toBe(false);
  });
});

describe("CSS static checks", () => {
  it("parses rules and declarations with offsets, including inside @media", () => {
    const css = `/* c */ .a { color: red; background: #fff }\n@media (min-width: 1px) { .b:focus { outline: none } }`;
    const rules = parseCss(css);
    expect(rules.map((r) => r.selector)).toEqual([".a", ".b:focus"]);
    const color = rules[0]!.declarations[0]!;
    expect(css.slice(color.valueStart, color.valueEnd)).toBe("red");
    expect(rules[1]!.atRule).toMatch(/@media/);
  });

  it("flags outline removal without a replacement", () => {
    const res = checkCss(`*:focus { outline: none; }`);
    expect(res.map((r) => r.ruleId)).toEqual(["awb-outline-suppressed"]);
  });

  it("does not flag outline removal when a focus style is restored", () => {
    expect(checkCss(`a:focus { outline: none; } a:focus-visible { outline: 2px solid blue; }`)).toHaveLength(0);
    expect(checkCss(`button:focus { outline: 0; box-shadow: 0 0 0 3px blue; }`)).toHaveLength(0);
  });

  it("measures declared colour pairs", () => {
    const res = checkCss(`.hint { color: #a0aab4; background-color: #ffffff; font-size: 14px; } .ok { color: #000; background: #fff; }`);
    expect(res).toHaveLength(1);
    expect(res[0]!.ruleId).toBe("awb-css-contrast");
    expect(res[0]!.contrast?.ratio).toBeLessThan(4.5);
    expect(res[0]!.contrast?.colorSource).toMatchObject({ kind: "rule", selector: ".hint" });
  });

  it("reports translucent declared backgrounds as inconclusive", () => {
    const res = checkCss(`.x { color: #777; background-color: rgba(255,255,255,0.5); }`);
    expect(res[0]!.kind).toBe("inconclusive");
  });

  it("reads <style> blocks out of HTML with document offsets", () => {
    const html = `<head><style>.m { color: #999 }</style></head>`;
    const rule = rulesFromHtml(html)[0]!;
    expect(html.slice(rule.declarations[0]!.valueStart, rule.declarations[0]!.valueEnd)).toBe("#999");
  });
});

describe("input validation", () => {
  it("requires authorisation and a URL for URL scans", () => {
    expect(UrlScanSchema.safeParse({ url: "https://example.org" }).success).toBe(false);
    expect(UrlScanSchema.safeParse({ url: "", authorized: true }).success).toBe(false);
    const ok = UrlScanSchema.safeParse({ url: "https://example.org", authorized: true });
    expect(ok.success && ok.data.profile).toBe("wcag22aa");
  });

  it("rejects malformed source input", () => {
    expect(SourceScanSchema.safeParse({ text: "" }).success).toBe(false);
    expect(SourceScanSchema.safeParse({ text: "x".repeat(300_001) }).success).toBe(false);
    expect(SourceScanSchema.safeParse({ text: "<p>", fileName: "../../etc/passwd" }).success).toBe(false);
    expect(SourceScanSchema.safeParse({ text: "<p>", profile: "wcag99" }).success).toBe(false);
    expect(SourceScanSchema.safeParse({ text: "<p>", fileName: "Card.tsx" }).success).toBe(true);
  });

  it("bounds verification payloads", () => {
    expect(VerifySchema.safeParse({ document: { dialect: "html", fileName: "a", origin: "user-source", text: "" }, patched: "", edits: [{ start: -1, end: 0, replacement: "" }], findings: [] }).success).toBe(false);
  });

  it("infers the dialect from the file name or content", () => {
    expect(inferDialect("Card.tsx", "")).toBe("jsx");
    expect(inferDialect("site.css", "")).toBe("css");
    expect(inferDialect("x", "export function A() { return <div className='a' /> }")).toBe("jsx");
    expect(inferDialect("x", ".a { color: red }")).toBe("css");
    expect(inferDialect("x", "<p>hi</p>")).toBe("html");
  });
});
