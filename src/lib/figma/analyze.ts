/**
 * Design-level checks on Figma document JSON. Runs in the browser for
 * JSON exports (the file never leaves the device) and on the server for
 * live API imports. Only what can be measured from layer data is
 * claimed; anything ambiguous is reported as inconclusive.
 */
import { z } from "zod";
import { evaluateContrast, formatRatio } from "@/lib/contrast/contrast";
import { toHex, type RGBA } from "@/lib/contrast/color";
import { normalizeCustom, sortFindings, type RawCustomResult } from "@/lib/findings/normalize";
import type { Audit } from "@/lib/findings/types";
import type { ProfileId } from "@/lib/standards/profiles";
import { PRODUCT_NAME, WORKBENCH_VERSION } from "@/lib/version";

const ColorSchema = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() });
const PaintSchema = z
  .object({ type: z.string(), visible: z.boolean().optional(), opacity: z.number().optional(), color: ColorSchema.optional(), blendMode: z.string().optional() })
  .passthrough();
export type FigmaPaint = z.infer<typeof PaintSchema>;

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  fills?: FigmaPaint[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  style?: { fontSize?: number; fontWeight?: number };
  characters?: string;
  backgroundColor?: { r: number; g: number; b: number; a?: number };
  children?: FigmaNode[];
}

const NodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: z.string().default(""),
      type: z.string(),
      visible: z.boolean().optional(),
      opacity: z.number().optional(),
      blendMode: z.string().optional(),
      isMask: z.boolean().optional(),
      fills: z.array(PaintSchema).optional().catch(undefined),
      absoluteBoundingBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional().catch(undefined),
      style: z.object({ fontSize: z.number().optional(), fontWeight: z.number().optional() }).passthrough().optional().catch(undefined),
      characters: z.string().optional(),
      backgroundColor: ColorSchema.optional(),
      children: z.array(NodeSchema).optional(),
    })
    .passthrough(),
) as z.ZodType<FigmaNode>;

export class FigmaFormatError extends Error {}

/** Accepts GET /v1/files/:key, GET /v1/files/:key/nodes, or a bare node. */
export function extractRoots(json: unknown): { name: string; roots: FigmaNode[] } {
  if (!json || typeof json !== "object") throw new FigmaFormatError("The file is not a JSON object.");
  const obj = json as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "Figma design";
  const candidates: unknown[] = [];
  if (obj.document) candidates.push(obj.document);
  else if (obj.nodes && typeof obj.nodes === "object") {
    for (const v of Object.values(obj.nodes as Record<string, unknown>)) if (v && typeof v === "object" && "document" in v) candidates.push((v as { document: unknown }).document);
  } else if (typeof obj.type === "string" && typeof obj.id === "string") candidates.push(obj);
  if (!candidates.length) {
    throw new FigmaFormatError("This JSON is not a Figma REST API response. Export it with GET /v1/files/:key or /v1/files/:key/nodes.");
  }
  const roots = candidates.map((c) => {
    const parsed = NodeSchema.safeParse(c);
    if (!parsed.success) throw new FigmaFormatError("The document tree does not match the Figma node format.");
    return parsed.data;
  });
  return { name, roots };
}

const toRGBA = (c: { r: number; g: number; b: number; a?: number }, alpha = 1): RGBA => ({ r: c.r * 255, g: c.g * 255, b: c.b * 255, a: (c.a ?? 1) * alpha });
const visible = (n: { visible?: boolean }) => n.visible !== false;
const NORMAL_BLEND = new Set([undefined, "NORMAL", "PASS_THROUGH"]);

type Box = { x: number; y: number; width: number; height: number };
const contains = (o: Box, i: Box) => o.x <= i.x + 0.5 && o.y <= i.y + 0.5 && o.x + o.width >= i.x + i.width - 0.5 && o.y + o.height >= i.y + i.height - 0.5;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface Painted {
  node: FigmaNode;
  path: string;
  opacity: number; // effective, including ancestors
  blendOk: boolean;
}

const INTERACTIVE_NAME = /\b(button|btn|icon[\s_-]?button|link|toggle|checkbox|radio|close|switch|tab|chip)\b/i;
const MAX_NODES = 60_000;

export function analyzeFigma(json: unknown, profile: ProfileId, meta: { fileName: string; via: "api" | "json"; fileKey?: string; nodeIds?: string[] }): Audit {
  const { name, roots } = extractRoots(json);
  const results: RawCustomResult[] = [];
  let textNodes = 0;
  let passes = 0;
  let nodeCount = 0;

  for (const root of roots) {
    // Pages (CANVAS) are analysed independently; each has its own background.
    const pages = root.type === "DOCUMENT" ? (root.children ?? []) : [root];
    for (const page of pages) {
      const canvas = page.backgroundColor ? toRGBA(page.backgroundColor) : null;
      const painted: Painted[] = [];
      const walk = (n: FigmaNode, path: string, parentOpacity: number, parentBlendOk: boolean) => {
        if (++nodeCount > MAX_NODES) throw new FigmaFormatError("The design has more than 60,000 layers. Import a specific frame with ?node-id= instead.");
        if (!visible(n)) return;
        const opacity = parentOpacity * (n.opacity ?? 1);
        const blendOk = parentBlendOk && NORMAL_BLEND.has(n.blendMode);
        const here = path ? `${path} / ${n.name}` : n.name;
        if (n.type === "TEXT") {
          textNodes++;
          const r = checkText(n, here, opacity, blendOk, painted, canvas);
          if (r.pass) passes++;
          results.push(...r.results);
        } else {
          checkTarget(n, here, results);
        }
        if (!n.isMask) painted.push({ node: n, path: here, opacity, blendOk });
        for (const c of n.children ?? []) walk(c, here, opacity, blendOk);
      };
      walk(page, "", 1, true);
    }
  }

  const findings = sortFindings(results.map((r) => normalizeCustom(r, profile)));
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    isDemo: false,
    status: "complete",
    input: { kind: "figma", fileName: meta.fileName || name, fileKey: meta.fileKey, nodeIds: meta.nodeIds, via: meta.via },
    profile,
    includeBestPractice: true,
    engine: { name: `${PRODUCT_NAME} design checks`, version: WORKBENCH_VERSION, workbench: WORKBENCH_VERSION },
    scope: {
      pageState: "Static design layers. Nothing was rendered or interacted with.",
      rulesRun: 3,
      notes: [`${textNodes} text layer${textNodes === 1 ? "" : "s"} checked for contrast; ${passes} met the threshold.`, `${nodeCount} layers read.`],
    },
    criteriaExercised: ["1.4.3", "2.5.8"],
    counts: { passes, violations: findings.filter((f) => f.kind === "violation").length, incomplete: findings.filter((f) => f.kind !== "violation").length, inapplicable: 0 },
    findings,
    warnings: [],
    limitations: [
      "Design checks measure layer colours and sizes only. Keyboard access, semantics, names and focus can only be tested in a built implementation.",
      "Text over gradients, images, blended or partly overlapping layers is reported as inconclusive rather than measured.",
      "Hover, focus, pressed and error variants are checked only if they exist as separate layers in the file.",
    ],
  };
}

function solidFill(fills: FigmaPaint[] | undefined): { color: RGBA | null; problem?: string } {
  const vis = (fills ?? []).filter((f) => visible(f) && (f.opacity ?? 1) > 0);
  if (!vis.length) return { color: null };
  if (vis.some((f) => f.type !== "SOLID" || !f.color)) {
    const kind = vis.find((f) => f.type !== "SOLID")?.type ?? "unknown";
    return { color: null, problem: kind.startsWith("GRADIENT") ? "a gradient" : kind === "IMAGE" ? "an image" : `a ${kind.toLowerCase()} fill` };
  }
  if (vis.some((f) => !NORMAL_BLEND.has(f.blendMode))) return { color: null, problem: "a blended fill" };
  // Stack multiple solid fills, last is on top.
  let acc: RGBA | null = null;
  for (const f of vis) {
    const c = toRGBA(f.color!, f.opacity ?? 1);
    if (!acc) acc = c;
    else {
      const below: RGBA = acc;
      const a: number = c.a + below.a * (1 - c.a);
      const ch = (t: number, b: number): number => (a ? (t * c.a + b * below.a * (1 - c.a)) / a : 0);
      acc = { r: ch(c.r, below.r), g: ch(c.g, below.g), b: ch(c.b, below.b), a };
    }
  }
  return { color: acc };
}

function checkText(n: FigmaNode, path: string, opacity: number, blendOk: boolean, painted: Painted[], canvas: RGBA | null): { results: RawCustomResult[]; pass: boolean } {
  const r = measureText(n, path, opacity, blendOk, painted, canvas);
  if (r === "pass") return { results: smallText(n, path), pass: true };
  return { results: [...smallText(n, path), ...(r ?? [])], pass: false };
}

function textHtml(n: FigmaNode): string {
  const chars = (n.characters ?? "").trim();
  const fontSizePx = n.style?.fontSize;
  const fontWeight = n.style?.fontWeight;
  return `TEXT "${chars.slice(0, 80)}"${fontSizePx ? ` ${fontSizePx}px` : ""}${fontWeight ? ` weight ${fontWeight}` : ""}`;
}

function smallText(n: FigmaNode, path: string): RawCustomResult[] {
  const size = n.style?.fontSize;
  if (!size || size >= 12 || !(n.characters ?? "").trim()) return [];
  return [{ ruleId: "awb-figma-small-text", kind: "heuristic", impact: "minor", selector: path, html: textHtml(n), evidence: [`Set at ${size}px.`], source: "figma" }];
}

function measureText(n: FigmaNode, path: string, opacity: number, blendOk: boolean, painted: Painted[], canvas: RGBA | null): RawCustomResult[] | "pass" | null {
  const box = n.absoluteBoundingBox;
  const chars = (n.characters ?? "").trim();
  if (!box || !chars || opacity <= 0) return null;
  const fontSizePx = n.style?.fontSize;
  const fontWeight = n.style?.fontWeight;
  const html = textHtml(n);
  const out: RawCustomResult[] = [];
  const unresolved = (reason: string): RawCustomResult => ({
    ruleId: "awb-figma-contrast-unresolved",
    kind: "inconclusive",
    impact: "moderate",
    selector: path,
    html,
    evidence: [reason],
    source: "figma",
    contrast: { required: fontSizePx && (fontSizePx >= 24 || (fontSizePx >= 18.66 && (fontWeight ?? 400) >= 700)) ? 3 : 4.5, fontSizePx, fontWeight, note: reason },
  });

  const fg = solidFill(n.fills);
  if (!fg.color) return fg.problem ? [unresolved(`The text uses ${fg.problem}.`)] : null;
  if (!blendOk) return [unresolved("The text or a parent layer uses a blend mode, so the rendered colour is unknown.")];
  const fgColor = { ...fg.color, a: fg.color.a * opacity };

  const layers: RGBA[] = [];
  for (let i = painted.length - 1; i >= 0; i--) {
    const p = painted[i]!;
    const pb = p.node.absoluteBoundingBox;
    if (p.node.type === "TEXT" || !pb || !intersects(pb, box)) continue; // glyph fills do not paint a box
    const fill = solidFill(p.node.fills);
    if (!fill.color && !fill.problem) continue; // no paint, transparent container
    if (!contains(pb, box)) return [unresolved(`The layer "${p.node.name}" only partly covers the text, so the background varies.`)];
    if (fill.problem) return [unresolved(`The layer behind the text ("${p.node.name}") uses ${fill.problem}.`)];
    if (!p.blendOk) return [unresolved(`The layer "${p.node.name}" uses a blend mode.`)];
    const c = { ...fill.color!, a: fill.color!.a * p.opacity };
    layers.push(c);
    if (c.a >= 0.999) break;
  }
  if (canvas) layers.push(canvas);

  const result = evaluateContrast({ foreground: fgColor, backgroundLayers: layers, kind: "text", fontSizePx, fontWeight });
  if (result.status === "pass") return "pass";
  if (result.status === "inconclusive") return [unresolved(result.reason ?? "The background could not be resolved.")];
  out.push({
    ruleId: "awb-figma-contrast",
    kind: "violation",
    impact: result.ratio! < result.required - 1.5 ? "serious" : "moderate",
    selector: path,
    html,
    source: "figma",
    evidence: [`${result.foregroundHex} on ${result.backgroundHex}: ${formatRatio(result.ratio!)} against a required ${result.required}:1${result.isLargeText ? " (large text)" : ""}.`],
    contrast: {
      foreground: result.foregroundHex,
      background: result.backgroundHex,
      ratio: result.ratio,
      required: result.required,
      fontSizePx,
      fontWeight,
      isLargeText: result.isLargeText,
    },
  });
  return out;
}

function checkTarget(n: FigmaNode, path: string, out: RawCustomResult[]) {
  const box = n.absoluteBoundingBox;
  if (!box || !["FRAME", "INSTANCE", "COMPONENT", "GROUP", "RECTANGLE", "ELLIPSE", "VECTOR"].includes(n.type)) return;
  if (!INTERACTIVE_NAME.test(n.name)) return;
  if (box.width >= 24 && box.height >= 24) return;
  out.push({
    ruleId: "awb-figma-target-size",
    kind: "needs-review",
    impact: "moderate",
    selector: path,
    html: `${n.type} "${n.name}" ${Math.round(box.width)} x ${Math.round(box.height)}`,
    source: "figma",
    evidence: [`The layer is ${Math.round(box.width)} by ${Math.round(box.height)} pixels. WCAG 2.2 asks for 24 by 24, or enough spacing around it.`],
  });
}

export { toHex };
