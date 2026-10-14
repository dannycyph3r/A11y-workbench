import {
  composite,
  flattenLayers,
  oklabToRgb,
  parseColor,
  rgbToOklab,
  srgbToLinear,
  toHex,
  type RGBA,
} from "./color";

/** WCAG relative luminance of an opaque sRGB colour. */
export function relativeLuminance(c: RGBA): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Formats a ratio for display. WCAG thresholds are not rounded, so this
 * truncates rather than rounds: 4.497 shows as 4.49, never 4.50.
 */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export type ContrastKind = "text" | "non-text";

export interface ContrastInput {
  foreground: string | RGBA;
  /** Background layers, top first. The last should be opaque. */
  backgroundLayers: (string | RGBA)[];
  kind: ContrastKind;
  /** Computed font size in CSS pixels (text only). */
  fontSizePx?: number;
  /** Numeric font weight, 400 normal, 700 bold (text only). */
  fontWeight?: number;
  /** Text inside images, gradients or video cannot be measured. */
  backgroundUnresolvable?: string;
}

export type ContrastStatus = "pass" | "fail" | "inconclusive";

export interface ContrastResult {
  status: ContrastStatus;
  ratio?: number;
  required: number;
  isLargeText: boolean;
  foregroundHex?: string;
  backgroundHex?: string;
  reason?: string;
}

/** 18pt (24px) or 14pt (about 18.66px) bold qualifies as large text. */
export function isLargeText(fontSizePx = 16, fontWeight = 400): boolean {
  if (fontSizePx >= 24) return true;
  return fontSizePx >= 18.66 && fontWeight >= 700;
}

export function requiredRatio(kind: ContrastKind, large: boolean): number {
  if (kind === "non-text") return 3;
  return large ? 3 : 4.5;
}

const resolve = (c: string | RGBA): RGBA | null => (typeof c === "string" ? parseColor(c) : c);

/**
 * Evaluates WCAG 1.4.3 (text) or 1.4.11 (non-text) contrast. Never
 * manufactures a ratio: if a colour cannot be parsed or the background
 * never resolves to an opaque layer, the result is inconclusive.
 */
export function evaluateContrast(input: ContrastInput): ContrastResult {
  const large = input.kind === "text" && isLargeText(input.fontSizePx, input.fontWeight);
  const required = requiredRatio(input.kind, large);

  if (input.backgroundUnresolvable) {
    return { status: "inconclusive", required, isLargeText: large, reason: input.backgroundUnresolvable };
  }
  const fg = resolve(input.foreground);
  if (!fg) {
    return { status: "inconclusive", required, isLargeText: large, reason: "Foreground colour could not be parsed." };
  }
  const layers = input.backgroundLayers.map(resolve);
  if (layers.length === 0 || layers.some((l) => l === null)) {
    return { status: "inconclusive", required, isLargeText: large, reason: "A background layer could not be parsed." };
  }
  const bg = flattenLayers(layers as RGBA[]);
  if (!bg) {
    return {
      status: "inconclusive",
      required,
      isLargeText: large,
      reason: "No opaque background was found, so the colour behind this element is unknown.",
    };
  }
  const effectiveFg = fg.a < 1 ? { ...composite(fg, bg), a: 1 } : fg;
  const ratio = contrastRatio(effectiveFg, bg);
  return {
    status: ratio >= required ? "pass" : "fail",
    ratio,
    required,
    isLargeText: large,
    foregroundHex: toHex(effectiveFg),
    backgroundHex: toHex(bg),
  };
}

export interface ColorSuggestion {
  hex: string;
  ratio: number;
  /** OKLab distance from the original: a rough measure of visual change. */
  deltaE: number;
  direction: "darker" | "lighter";
}

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((v) => v >= -0.5 && v <= 255.5);
}

/**
 * Finds the closest colour to `foreground` that meets `target` against an
 * opaque background, holding OKLCH hue and as much chroma as fits in
 * sRGB. Returns null when no colour in that hue can reach the target.
 */
export function suggestForeground(foreground: RGBA, background: RGBA, target: number): ColorSuggestion | null {
  const [L0, a0, b0] = rgbToOklab({ ...foreground, a: 1 });
  // Near-neutral greys have no meaningful hue; keep them neutral instead of tinting them.
  const C0 = Math.hypot(a0, b0) < 0.004 ? 0 : Math.hypot(a0, b0);
  const h = Math.atan2(b0, a0);
  const bgLum = relativeLuminance(background);
  const directions: ("darker" | "lighter")[] = bgLum > 0.18 ? ["darker", "lighter"] : ["lighter", "darker"];

  const colourAt = (L: number): RGBA => {
    // Reduce chroma until the colour fits in sRGB.
    let C = C0;
    for (let i = 0; i < 30; i++) {
      const rgb = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
      if (inGamut(rgb)) {
        return { r: Math.round(Math.min(255, Math.max(0, rgb[0]))), g: Math.round(Math.min(255, Math.max(0, rgb[1]))), b: Math.round(Math.min(255, Math.max(0, rgb[2]))), a: 1 };
      }
      C *= 0.85;
    }
    const grey = oklabToRgb(L, 0, 0).map((v) => Math.round(Math.min(255, Math.max(0, v))));
    return { r: grey[0]!, g: grey[1]!, b: grey[2]!, a: 1 };
  };

  for (const direction of directions) {
    const end = direction === "darker" ? 0 : 1;
    if (contrastRatio(colourAt(end), background) < target) continue;
    // Binary search for the smallest lightness move that passes.
    let lo = L0,
      hi = end;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(colourAt(mid), background) >= target) hi = mid;
      else lo = mid;
    }
    // Rounding to hex can land a hair under the target; nudge until it holds.
    let L = hi;
    let c = colourAt(L);
    for (let i = 0; i < 50 && contrastRatio(c, background) < target; i++) {
      L += direction === "darker" ? -0.002 : 0.002;
      c = colourAt(L);
    }
    const ratio = contrastRatio(c, background);
    if (ratio < target) continue;
    const [L1, a1, b1] = rgbToOklab(c);
    return {
      hex: toHex(c),
      ratio,
      deltaE: Math.hypot(L1 - L0, a1 - a0, b1 - b0),
      direction,
    };
  }
  return null;
}
