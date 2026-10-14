/** A replacement of the text between `start` and `end` (end exclusive). */
export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

export class EditConflictError extends Error {
  constructor(
    message: string,
    public a: TextEdit,
    public b: TextEdit,
  ) {
    super(message);
  }
}

const same = (a: TextEdit, b: TextEdit) => a.start === b.start && a.end === b.end && a.replacement === b.replacement;

/** Two edits conflict when their ranges overlap, or both insert at the same point with different text. */
export function editsConflict(a: TextEdit, b: TextEdit): boolean {
  if (same(a, b)) return false;
  const aInsert = a.start === a.end;
  const bInsert = b.start === b.end;
  if (aInsert && bInsert) return a.start === b.start;
  if (aInsert) return a.start > b.start && a.start < b.end;
  if (bInsert) return b.start > a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

/** Removes exact duplicates, which happen when two findings share one fix (for example one CSS rule). */
export function dedupeEdits(edits: TextEdit[]): TextEdit[] {
  const out: TextEdit[] = [];
  for (const e of edits) if (!out.some((o) => same(o, e))) out.push(e);
  return out;
}

/** Applies non-overlapping edits. Throws EditConflictError on overlap; never silently drops an edit. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = dedupeEdits(edits).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (editsConflict(prev, cur)) throw new EditConflictError("Two proposed changes touch the same text.", prev, cur);
  }
  let out = "";
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor || e.end > text.length || e.start > e.end) throw new EditConflictError("A proposed change is out of range.", e, e);
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

/**
 * Maps an offset in the original text to the patched text. Insertions at
 * the offset push it forward; offsets inside a replaced range map to its start.
 */
export function mapOffset(offset: number, edits: TextEdit[]): number {
  let delta = 0;
  for (const e of dedupeEdits(edits).sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (e.end <= offset) delta += e.replacement.length - (e.end - e.start);
    else if (e.start < offset && offset < e.end) return e.start + delta;
  }
  return offset + delta;
}
