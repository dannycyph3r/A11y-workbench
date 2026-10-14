/**
 * A minimal CSS rule scanner and the static checks that can run on a
 * stylesheet without rendering anything. Declarations are reported with
 * exact offsets so fixes can edit values in place.
 */
import { parseColor } from "@/lib/contrast/color";
import { evaluateContrast, formatRatio } from "@/lib/contrast/contrast";
import type { RawCustomResult } from "@/lib/findings/normalize";
import { lineIndex } from "./tags";

export interface CssDeclaration {
  property: string;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

export interface CssRule {
  selector: string;
  selectorStart: number;
  blockStart: number; // offset of "{"
  blockEnd: number; // offset just past "}"
  declarations: CssDeclaration[];
  atRule?: string;
}

/** Replaces comments with spaces so offsets stay aligned with the source. */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

function parseDeclarations(text: string, from: number, to: number): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  let i = from;
  while (i < to) {
    let semi = i;
    let depth = 0;
    while (semi < to) {
      const c = text[semi];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ";" && depth === 0) break;
      semi++;
    }
    const chunk = text.slice(i, semi);
    const colon = chunk.indexOf(":");
    if (colon > 0) {
      const property = chunk.slice(0, colon).trim().toLowerCase();
      const rawValue = chunk.slice(colon + 1);
      const leading = rawValue.length - rawValue.trimStart().length;
      const value = rawValue.trim();
      const valueStart = i + colon + 1 + leading;
      if (property && value) {
        const propStart = i + (chunk.length - chunk.trimStart().length);
        decls.push({ property, value, start: propStart, end: valueStart + value.length, valueStart, valueEnd: valueStart + value.length });
      }
    }
    i = semi + 1;
  }
  return decls;
}

export function parseCss(source: string, baseOffset = 0): CssRule[] {
  const text = blankComments(source);
  const rules: CssRule[] = [];
  const walk = (from: number, to: number, atRule?: string) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      if (open === -1 || open >= to) return;
      const prelude = text.slice(i, open);
      const selector = prelude.trim();
      const selectorStart = i + (prelude.length - prelude.trimStart().length);
      let depth = 1;
      let j = open + 1;
      while (j < to && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      if (selector.startsWith("@")) {
        if (/^@(media|supports|layer|container)/i.test(selector)) walk(open + 1, j - 1, selector);
      } else {
        rules.push({
          selector,
          selectorStart: selectorStart + baseOffset,
          blockStart: open + baseOffset,
          blockEnd: j + baseOffset,
          declarations: parseDeclarations(text, open + 1, j - 1).map((d) => ({
            ...d,
            start: d.start + baseOffset,
            end: d.end + baseOffset,
            valueStart: d.valueStart + baseOffset,
            valueEnd: d.valueEnd + baseOffset,
          })),
          atRule,
        });
      }
      i = j;
    }
  };
  walk(0, text.length);
  return rules;
}

/** Extracts every <style> block from an HTML document as CSS rules with document offsets. */
export function rulesFromHtml(html: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1] ?? "";
    const offset = m.index + m[0].indexOf(body);
    rules.push(...parseCss(body, offset));
  }
  return rules;
}

const last = (decls: CssDeclaration[], prop: string) => [...decls].reverse().find((d) => d.property === prop);

const FOCUS_TARGET = /:focus|(^|[\s,>+~])\*|(^|[\s,>+~(])(a|button|input|select|textarea|summary)\b|\[tabindex/i;
const INDICATOR_PROPS = ["box-shadow", "border", "border-color", "border-bottom", "background", "background-color", "text-decoration", "outline-color"];

function outlineRemoved(decls: CssDeclaration[]): CssDeclaration | undefined {
  return decls.find(
    (d) =>
      (d.property === "outline" && /^(none|0(px)?)(\s|$|!)/i.test(d.value)) ||
      (d.property === "outline-style" && /^none/i.test(d.value)) ||
      (d.property === "outline-width" && /^0(px)?(\s|$|!)/i.test(d.value)),
  );
}

/** Static stylesheet checks: outline suppression and declared colour pairs. */
export function checkCss(text: string, rules: CssRule[] = parseCss(text)): RawCustomResult[] {
  const pos = lineIndex(text);
  const results: RawCustomResult[] = [];
  // Is there any focus-visible or focus rule that restores an indicator?
  const restores = rules.some(
    (r) => /:focus(-visible)?/.test(r.selector) && r.declarations.some((d) => (d.property.startsWith("outline") && !/none|^0/.test(d.value)) || d.property === "box-shadow"),
  );

  for (const rule of rules) {
    const { line, column } = pos(rule.selectorStart);
    const location = { start: rule.selectorStart, end: rule.blockEnd, line, column };
    const snippet = text.slice(rule.selectorStart, Math.min(rule.blockEnd, rule.selectorStart + 400));

    const removed = outlineRemoved(rule.declarations);
    if (removed && FOCUS_TARGET.test(rule.selector)) {
      const hasAlt = INDICATOR_PROPS.some((p) => rule.declarations.some((d) => d.property === p));
      if (!hasAlt && !restores) {
        results.push({
          ruleId: "awb-outline-suppressed",
          kind: "heuristic",
          impact: "serious",
          selector: rule.selector,
          html: snippet,
          location,
          source: "static-css",
          evidence: [
            `\`${removed.property}: ${removed.value}\` removes the focus outline for \`${rule.selector}\`.`,
            "No other rule in this stylesheet adds a focus or focus-visible indicator.",
          ],
        });
      }
    }

    const color = last(rule.declarations, "color");
    const bgDecl = last(rule.declarations, "background-color") ?? last(rule.declarations, "background");
    if (color && bgDecl) {
      const fg = parseColor(color.value.replace(/\s*!important$/i, ""));
      const bg = parseColor(bgDecl.value.replace(/\s*!important$/i, ""));
      const sizeDecl = last(rule.declarations, "font-size");
      const weightDecl = last(rule.declarations, "font-weight");
      const px = sizeDecl ? /^([\d.]+)px$/.exec(sizeDecl.value)?.[1] : undefined;
      const rem = sizeDecl ? /^([\d.]+)rem$/.exec(sizeDecl.value)?.[1] : undefined;
      const fontSizePx = px ? parseFloat(px) : rem ? parseFloat(rem) * 16 : undefined;
      const fontWeight = weightDecl ? (weightDecl.value === "bold" ? 700 : parseInt(weightDecl.value, 10) || 400) : undefined;
      if (fg && bg) {
        const result = evaluateContrast({
          foreground: fg,
          backgroundLayers: [bg],
          kind: "text",
          fontSizePx,
          fontWeight,
          backgroundUnresolvable: bg.a < 1 ? "The declared background is translucent, so the colour behind it is unknown." : undefined,
        });
        if (result.status !== "pass") {
          results.push({
            ruleId: "awb-css-contrast",
            kind: result.status === "fail" ? "heuristic" : "inconclusive",
            impact: "serious",
            selector: rule.selector,
            html: snippet,
            location,
            source: "static-css",
            contrast: {
              foreground: result.foregroundHex ?? color.value,
              background: result.backgroundHex ?? bgDecl.value,
              ratio: result.ratio,
              required: result.required,
              fontSizePx,
              fontWeight,
              isLargeText: result.isLargeText,
              colorSource: { kind: "rule", selector: rule.selector, value: color.value },
              note: result.reason,
            },
            evidence:
              result.status === "fail"
                ? [
                    `\`${rule.selector}\` declares ${color.value} on ${bgDecl.value}: ${formatRatio(result.ratio!)} against a required ${result.required}:1.`,
                    "Measured from declared values. Other rules in the cascade may change what renders.",
                  ]
                : [result.reason ?? "Contrast could not be measured."],
          });
        }
      }
    }
  }
  return results;
}
