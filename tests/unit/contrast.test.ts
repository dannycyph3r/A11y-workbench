import { describe, expect, it } from "vitest";
import { composite, flattenLayers, parseColor, toHex } from "@/lib/contrast/color";
import { contrastRatio, evaluateContrast, formatRatio, isLargeText, relativeLuminance, suggestForeground } from "@/lib/contrast/contrast";

const c = (s: string) => {
  const v = parseColor(s);
  if (!v) throw new Error(`unparsed ${s}`);
  return v;
};

describe("parseColor", () => {
  it.each([
    ["#fff", { r: 255, g: 255, b: 255, a: 1 }],
    ["#000000", { r: 0, g: 0, b: 0, a: 1 }],
    ["#0080ff80", { r: 0, g: 128, b: 255, a: 128 / 255 }],
    ["rgb(10, 20, 30)", { r: 10, g: 20, b: 30, a: 1 }],
    ["rgba(10, 20, 30, 0.5)", { r: 10, g: 20, b: 30, a: 0.5 }],
    ["rgb(10 20 30 / 25%)", { r: 10, g: 20, b: 30, a: 0.25 }],
    ["rgb(100% 0% 0%)", { r: 255, g: 0, b: 0, a: 1 }],
    ["hsl(0, 100%, 50%)", { r: 255, g: 0, b: 0, a: 1 }],
    ["hsl(120 100% 25%)", { r: 0, g: 128, b: 0, a: 1 }],
    ["rebeccapurple", { r: 102, g: 51, b: 153, a: 1 }],
    ["transparent", { r: 0, g: 0, b: 0, a: 0 }],
    ["color(srgb 1 0 0)", { r: 255, g: 0, b: 0, a: 1 }],
  ])("parses %s", (input, expected) => {
    const got = parseColor(input)!;
    expect(got.r).toBe(expected.r);
    expect(got.g).toBe(expected.g);
    expect(got.b).toBe(expected.b);
    expect(got.a).toBeCloseTo(expected.a, 3);
  });

  it("parses oklch and oklab close to their sRGB equivalents", () => {
    expect(toHex(c("oklch(0.628 0.2577 29.23)"))).toBe("#ff0000");
    expect(toHex(c("oklab(1 0 0)"))).toBe("#ffffff");
  });

  it.each(["", "linear-gradient(red, blue)", "var(--x)", "currentColor", "#ggg", "rgb(1,2)", "notacolor"])("returns null for %j", (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe("luminance and ratio", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance(c("#ffffff"))).toBeCloseTo(1, 6);
    expect(relativeLuminance(c("#000000"))).toBe(0);
    expect(contrastRatio(c("#000"), c("#fff"))).toBeCloseTo(21, 6);
    expect(contrastRatio(c("#fff"), c("#fff"))).toBe(1);
    expect(contrastRatio(c("#777777"), c("#ffffff"))).toBeCloseTo(4.48, 2);
    expect(contrastRatio(c("#767676"), c("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio(c("#123456"), c("#abcdef"))).toBeCloseTo(contrastRatio(c("#abcdef"), c("#123456")), 10);
  });

  it("truncates when formatting so a failing ratio never displays as passing", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });
});

describe("thresholds", () => {
  it("classifies large text at 24px, or 18.66px bold", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 600)).toBe(false);
  });

  it("requires 4.5 for normal text, 3 for large text and non-text", () => {
    expect(evaluateContrast({ foreground: "#767676", backgroundLayers: ["#fff"], kind: "text", fontSizePx: 16 }).status).toBe("pass");
    expect(evaluateContrast({ foreground: "#777777", backgroundLayers: ["#fff"], kind: "text", fontSizePx: 16 }).status).toBe("fail");
    const large = evaluateContrast({ foreground: "#949494", backgroundLayers: ["#fff"], kind: "text", fontSizePx: 24 });
    expect(large.required).toBe(3);
    expect(large.status).toBe("pass");
    expect(evaluateContrast({ foreground: "#949494", backgroundLayers: ["#fff"], kind: "non-text" }).required).toBe(3);
  });
});

describe("transparency", () => {
  it("composites translucent text over its background", () => {
    // 50% black over white is #808080 (rounded), about 3.95:1.
    const r = evaluateContrast({ foreground: "rgba(0,0,0,0.5)", backgroundLayers: ["#ffffff"], kind: "text" });
    expect(r.foregroundHex).toBe("#808080");
    expect(r.ratio).toBeCloseTo(3.95, 1);
    expect(r.status).toBe("fail");
  });

  it("flattens a translucent background over an opaque one", () => {
    const flat = flattenLayers([c("rgba(0,0,0,0.5)"), c("#ffffff")])!;
    expect(toHex(flat)).toBe("#808080");
    expect(composite(c("transparent"), c("#123456"))).toMatchObject({ r: 0x12, g: 0x34, b: 0x56 });
  });

  it("is inconclusive when no opaque background is reached", () => {
    const r = evaluateContrast({ foreground: "#000", backgroundLayers: ["rgba(255,255,255,0.4)"], kind: "text" });
    expect(r.status).toBe("inconclusive");
    expect(r.ratio).toBeUndefined();
  });

  it("is inconclusive for unresolvable backgrounds and unparseable colours", () => {
    expect(evaluateContrast({ foreground: "#000", backgroundLayers: ["#fff"], kind: "text", backgroundUnresolvable: "Image background" }).status).toBe("inconclusive");
    expect(evaluateContrast({ foreground: "var(--ink)", backgroundLayers: ["#fff"], kind: "text" }).status).toBe("inconclusive");
    expect(evaluateContrast({ foreground: "#000", backgroundLayers: [], kind: "text" }).status).toBe("inconclusive");
  });
});

describe("suggestForeground", () => {
  it("finds the nearest passing colour and keeps greys neutral", () => {
    const s = suggestForeground(c("#9a9a9a"), c("#ffffff"), 4.5)!;
    expect(s.ratio).toBeGreaterThanOrEqual(4.5);
    expect(s.ratio).toBeLessThan(4.7);
    expect(s.direction).toBe("darker");
    const out = c(s.hex);
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
  });

  it("lightens text on a dark background", () => {
    const s = suggestForeground(c("#555555"), c("#111111"), 4.5)!;
    expect(s.direction).toBe("lighter");
    expect(contrastRatio(c(s.hex), c("#111111"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the hue of a chromatic colour", () => {
    const s = suggestForeground(c("#7fb3d5"), c("#ffffff"), 4.5)!;
    const out = c(s.hex);
    expect(out.b).toBeGreaterThan(out.r); // still blue
    expect(contrastRatio(out, c("#ffffff"))).toBeGreaterThanOrEqual(4.5);
  });
});
