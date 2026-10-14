/**
 * Colour parsing and compositing. Everything resolves to sRGB with a
 * straight (non-premultiplied) alpha channel in 0..1.
 */

export interface RGBA {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

// CSS Color 4 named colours, packed as name:hex6.
const NAMED_PACKED =
  "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32";

const NAMED = new Map<string, string>(
  NAMED_PACKED.split(" ").map((pair) => pair.split(":") as [string, string]),
);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parseHex(hex: string): RGBA | null {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}

/** Splits the inside of a CSS colour function in either comma or space syntax. */
function splitArgs(inner: string): { parts: string[]; alpha?: string } | null {
  const trimmed = inner.trim();
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
    if (parts.length === 3) return { parts };
    return null;
  }
  const [main, alpha] = trimmed.split("/").map((s) => s.trim());
  if (!main) return null;
  const parts = main.split(/\s+/);
  if (parts.length !== 3) return null;
  return { parts, alpha };
}

function num(s: string, percentScale: number): number | null {
  if (s === "none") return 0;
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(%|deg|rad|turn)?$/i.exec(s);
  if (!m || m[1] === undefined) return null;
  const v = parseFloat(m[1]);
  if (m[2] === "%") return (v / 100) * percentScale;
  if (m[2] === "rad") return (v * 180) / Math.PI;
  if (m[2] === "turn") return v * 360;
  return v;
}

function parseAlpha(s: string | undefined): number | null {
  if (s === undefined) return 1;
  const v = num(s, 1);
  return v === null ? null : clamp(v, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// OKLab conversions (Björn Ottosson), used for parsing oklch()/oklab()
// and for hue-preserving lightness adjustment in suggestions.
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function rgbToOklab(c: RGBA): [number, number, number] {
  const r = srgbToLinear(c.r),
    g = srgbToLinear(c.g),
    b = srgbToLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Parses a CSS colour. Supports hex, rgb(a), hsl(a), oklab, oklch,
 * color(srgb ...), named colours and "transparent". Returns null for
 * anything else (gradients, var(), currentColor, unknown syntax), so
 * callers can treat the value as unresolved rather than guessing.
 */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) return parseHex(s);
  const named = NAMED.get(s);
  if (named) return parseHex(named);

  const fn = /^([a-z]+)\((.*)\)$/.exec(s);
  if (!fn || fn[1] === undefined || fn[2] === undefined) return null;
  const name = fn[1];
  const inner = fn[2];

  if (name === "color") {
    const m = /^srgb\s+(.*)$/.exec(inner.trim());
    if (!m || m[1] === undefined) return null;
    const args = splitArgs(m[1]);
    if (!args) return null;
    const vals = args.parts.map((p) => num(p, 1));
    const a = parseAlpha(args.alpha);
    if (vals.some((v) => v === null) || a === null) return null;
    const [r, g, b] = vals as number[];
    return round({ r: r! * 255, g: g! * 255, b: b! * 255, a });
  }

  const args = splitArgs(inner);
  if (!args) return null;
  const a = parseAlpha(args.alpha);
  if (a === null) return null;
  const [p0, p1, p2] = args.parts as [string, string, string];

  if (name === "rgb" || name === "rgba") {
    const vals = [p0, p1, p2].map((p) => num(p, 255));
    if (vals.some((v) => v === null)) return null;
    const [r, g, b] = vals as number[];
    return round({ r: r!, g: g!, b: b!, a });
  }
  if (name === "hsl" || name === "hsla") {
    const h = num(p0, 360);
    const sat = num(p1.endsWith("%") ? p1 : `${p1}%`, 1);
    const l = num(p2.endsWith("%") ? p2 : `${p2}%`, 1);
    if (h === null || sat === null || l === null) return null;
    const [r, g, b] = hslToRgb(h, clamp(sat, 0, 1), clamp(l, 0, 1));
    return round({ r, g, b, a });
  }
  if (name === "oklab") {
    const L = num(p0, 1),
      A = num(p1, 0.4),
      B = num(p2, 0.4);
    if (L === null || A === null || B === null) return null;
    const [r, g, b] = oklabToRgb(L, A, B);
    return round({ r, g, b, a });
  }
  if (name === "oklch") {
    const L = num(p0, 1),
      C = num(p1, 0.4),
      H = num(p2, 360);
    if (L === null || C === null || H === null) return null;
    const rad = (H * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
    return round({ r, g, b, a });
  }
  return null;
}

function round(c: RGBA): RGBA {
  return {
    r: clamp(Math.round(c.r), 0, 255),
    g: clamp(Math.round(c.g), 0, 255),
    b: clamp(Math.round(c.b), 0, 255),
    a: clamp(c.a, 0, 1),
  };
}

/** Source-over compositing of `top` onto `bottom`. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a };
}

/**
 * Flattens a stack of background layers (listed top first) into one
 * opaque colour. Returns null if the stack never reaches an opaque
 * layer, because the true backdrop is then unknown.
 */
export function flattenLayers(layersTopFirst: RGBA[]): RGBA | null {
  let acc: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  for (const layer of layersTopFirst) {
    // acc is on top of everything below it, so acc composites over layer.
    acc = composite(acc, layer);
    if (acc.a >= 0.999) return { ...acc, a: 1 };
  }
  return null;
}

export function toHex(c: RGBA): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a < 1 ? `${base}${h(c.a * 255)}` : base;
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  return (
    Math.round(a.r) === Math.round(b.r) &&
    Math.round(a.g) === Math.round(b.g) &&
    Math.round(a.b) === Math.round(b.b) &&
    Math.abs(a.a - b.a) < 0.01
  );
}
