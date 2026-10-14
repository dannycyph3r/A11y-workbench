import { createTwoFilesPatch, diffLines } from "diff";

export interface DiffSide {
  lineNo: number;
  /** Text split around the changed segment so it can be highlighted. */
  before: string;
  changed: string;
  after: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export type DiffRow =
  | { kind: "context"; left: DiffSide; right: DiffSide }
  | { kind: "change"; left?: DiffSide; right?: DiffSide }
  | { kind: "fold"; count: number };

const WINDOW = 140;
const LONG = 320;

function plainSide(lineNo: number, text: string): DiffSide {
  if (text.length <= LONG) return { lineNo, before: text, changed: "", after: "", truncatedStart: false, truncatedEnd: false };
  return { lineNo, before: text.slice(0, LONG), changed: "", after: "", truncatedStart: false, truncatedEnd: true };
}

/** Splits two versions of a line into shared prefix, differing middle and shared suffix. */
function pairSides(lineL: number, a: string, lineR: number, b: string): [DiffSide, DiffSide] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const make = (lineNo: number, t: string): DiffSide => {
    const midEnd = t.length - s;
    const from = Math.max(0, p - WINDOW);
    const to = Math.min(t.length, midEnd + WINDOW);
    return {
      lineNo,
      before: t.slice(from, p),
      changed: t.slice(p, midEnd),
      after: t.slice(midEnd, to),
      truncatedStart: from > 0,
      truncatedEnd: to < t.length,
    };
  };
  return [make(lineL, a), make(lineR, b)];
}

const splitLines = (value: string) => {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/**
 * Builds side-by-side rows for a line diff. Unchanged runs longer than
 * twice the context are folded. Very long lines (minified markup) are
 * windowed around the change so the diff stays readable.
 */
export function buildDiffRows(before: string, after: string, context = 3): DiffRow[] {
  const parts = diffLines(before, after);
  const rows: DiffRow[] = [];
  let l = 1;
  let r = 1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lines = splitLines(part.value);
    if (!part.added && !part.removed) {
      const isFirst = rows.length === 0;
      const isLast = i === parts.length - 1;
      const keepHead = isFirst ? 0 : context;
      const keepTail = isLast ? 0 : context;
      if (lines.length > keepHead + keepTail + 1) {
        for (let k = 0; k < keepHead; k++) rows.push({ kind: "context", left: plainSide(l + k, lines[k]!), right: plainSide(r + k, lines[k]!) });
        rows.push({ kind: "fold", count: lines.length - keepHead - keepTail });
        for (let k = lines.length - keepTail; k < lines.length; k++) rows.push({ kind: "context", left: plainSide(l + k, lines[k]!), right: plainSide(r + k, lines[k]!) });
      } else {
        lines.forEach((t, k) => rows.push({ kind: "context", left: plainSide(l + k, t), right: plainSide(r + k, t) }));
      }
      l += lines.length;
      r += lines.length;
      continue;
    }
    if (part.removed && parts[i + 1]?.added) {
      const added = splitLines(parts[i + 1]!.value);
      const n = Math.max(lines.length, added.length);
      for (let k = 0; k < n; k++) {
        const a = lines[k];
        const b = added[k];
        if (a !== undefined && b !== undefined) {
          const [left, right] = pairSides(l + k, a, r + k, b);
          rows.push({ kind: "change", left, right });
        } else if (a !== undefined) rows.push({ kind: "change", left: { ...plainSide(l + k, a), changed: a.length <= LONG ? a : a.slice(0, LONG), before: "" } });
        else if (b !== undefined) rows.push({ kind: "change", right: { ...plainSide(r + k, b), changed: b.length <= LONG ? b : b.slice(0, LONG), before: "" } });
      }
      l += lines.length;
      r += added.length;
      i++;
      continue;
    }
    for (const t of lines) {
      if (part.removed) rows.push({ kind: "change", left: { ...plainSide(l++, t), changed: t.slice(0, LONG), before: "" } });
      else rows.push({ kind: "change", right: { ...plainSide(r++, t), changed: t.slice(0, LONG), before: "" } });
    }
  }
  return rows;
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) if (row.kind === "change") {
    if (row.left) removed++;
    if (row.right) added++;
  }
  return { added, removed };
}

/** A standard unified diff, suitable for `git apply` or `patch -p1`. */
export function unifiedPatch(fileName: string, before: string, after: string): string {
  return createTwoFilesPatch(`a/${fileName}`, `b/${fileName}`, before, after, undefined, undefined, { context: 3 });
}
