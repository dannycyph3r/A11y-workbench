import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseColor } from "@/lib/contrast/color";
import { contrastRatio } from "@/lib/contrast/contrast";

/**
 * The app's own colour tokens, measured with the same contrast utility
 * the scanner uses. Every pair that the interface actually renders is
 * listed here, in both themes.
 */
const css = readFileSync("src/app/globals.css", "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = { ...light, ...tokens(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("@theme inline"))) };

const TEXT: [string, string][] = [
  ...["ink", "ink-2", "ink-3"].flatMap((fg) => ["page", "surface", "surface-2"].map((bg) => [fg, bg] as [string, string])),
  ["ink-2", "sunk"],
  ["ink-3", "sunk"],
  ["accent-ink", "surface"],
  ["accent-ink", "accent-wash"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ...["critical", "serious", "moderate", "minor", "resolved", "review"].flatMap((t) => [[t, `${t}-wash`], [t, "surface"]] as [string, string][]),
  ["ink", "diff-add"],
  ["ink", "diff-del"],
  ["ink", "diff-add-strong"],
  ["ink", "diff-del-strong"],
  ["surface", "critical"],
  ["surface", "resolved"],
  ["ink", "accent-wash"],
];

const NON_TEXT: [string, string][] = [
  ["line-control", "surface"],
  ["line-control", "page"],
  ["focus", "surface"],
  ["focus", "page"],
  ["accent", "surface"],
  ["critical", "critical-wash"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme tokens", (_name, t) => {
  const ratio = (a: string, b: string) => {
    const fa = parseColor(t[a] ?? "");
    const fb = parseColor(t[b] ?? "");
    if (!fa || !fb) throw new Error(`missing token ${a} or ${b}`);
    return contrastRatio(fa, fb);
  };
  it.each(TEXT)("text %s on %s reaches 4.5:1", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT)("boundary %s against %s reaches 3:1", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
