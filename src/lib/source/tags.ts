/**
 * A small, offset-preserving tag scanner for HTML and JSX opening tags.
 * It is not a full HTML parser: it finds start and end tags with exact
 * character ranges so fixes can edit the original text without
 * reformatting anything around them.
 */

export type Dialect = "html" | "jsx";

export interface AttrToken {
  kind: "attr";
  name: string;
  /** Range of the whole attribute, including its value. */
  start: number;
  end: number;
  /** Raw value text without quotes, or null for a bare attribute. */
  value: string | null;
  /** Range of the value text (inside quotes or braces). */
  valueStart?: number;
  valueEnd?: number;
  quote?: '"' | "'" | "{" | "";
}

export interface SpreadToken {
  kind: "spread";
  start: number;
  end: number;
}

export interface StartTag {
  name: string;
  start: number;
  /** Offset just past the closing ">". */
  end: number;
  selfClosing: boolean;
  attrs: AttrToken[];
  spreads: SpreadToken[];
  /** Offset where a new attribute can be inserted (before "/>" or ">"). */
  insertAt: number;
}

export interface EndTag {
  name: string;
  start: number;
  end: number;
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export function isVoidElement(name: string): boolean {
  return VOID.has(name.toLowerCase());
}

const isNameChar = (c: string) => /[A-Za-z0-9_.:\-]/.test(c);
const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** Skips a balanced { ... } block, honouring string and template literals. Returns offset past "}". */
function skipBraces(text: string, i: number): number {
  let depth = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}

/** Parses the start tag that begins at `offset` (which must point at "<"). */
export function parseStartTagAt(text: string, offset: number, dialect: Dialect = "html"): StartTag | null {
  if (text[offset] !== "<") return null;
  let i = offset + 1;
  const nameStart = i;
  while (i < text.length && isNameChar(text[i]!)) i++;
  if (i === nameStart) return null;
  const name = text.slice(nameStart, i);
  const attrs: AttrToken[] = [];
  const spreads: SpreadToken[] = [];

  while (i < text.length) {
    while (isSpace(text[i])) i++;
    const c = text[i];
    if (c === undefined) return null;
    if (c === ">") {
      return { name, start: offset, end: i + 1, selfClosing: false, attrs, spreads, insertAt: trimBack(text, i) };
    }
    if (c === "/" && text[i + 1] === ">") {
      return { name, start: offset, end: i + 2, selfClosing: true, attrs, spreads, insertAt: trimBack(text, i) };
    }
    if (dialect === "jsx" && c === "{") {
      const end = skipBraces(text, i);
      spreads.push({ kind: "spread", start: i, end });
      i = end;
      continue;
    }
    // Attribute name
    const aStart = i;
    while (i < text.length && !isSpace(text[i]) && text[i] !== "=" && text[i] !== ">" && !(text[i] === "/" && text[i + 1] === ">")) i++;
    if (i === aStart) {
      i++; // stray character, step over it
      continue;
    }
    const aName = text.slice(aStart, i);
    let j = i;
    while (isSpace(text[j])) j++;
    if (text[j] !== "=") {
      attrs.push({ kind: "attr", name: aName, start: aStart, end: i, value: null });
      continue;
    }
    j++;
    while (isSpace(text[j])) j++;
    const q = text[j];
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, j + 1);
      if (close === -1) return null;
      attrs.push({ kind: "attr", name: aName, start: aStart, end: close + 1, value: text.slice(j + 1, close), valueStart: j + 1, valueEnd: close, quote: q });
      i = close + 1;
    } else if (q === "{" && dialect === "jsx") {
      const end = skipBraces(text, j);
      attrs.push({ kind: "attr", name: aName, start: aStart, end, value: text.slice(j + 1, end - 1), valueStart: j + 1, valueEnd: end - 1, quote: "{" });
      i = end;
    } else {
      const vStart = j;
      while (j < text.length && !isSpace(text[j]) && text[j] !== ">") j++;
      attrs.push({ kind: "attr", name: aName, start: aStart, end: j, value: text.slice(vStart, j), valueStart: vStart, valueEnd: j, quote: "" });
      i = j;
    }
  }
  return null;
}

function trimBack(text: string, i: number): number {
  let k = i;
  while (k > 0 && isSpace(text[k - 1])) k--;
  return k;
}

export interface ScanResult {
  starts: StartTag[];
  ends: EndTag[];
}

/** Scans an HTML document for start and end tags, skipping comments and raw-text bodies. */
export function scanHtml(text: string, dialect: Dialect = "html"): ScanResult {
  const starts: StartTag[] = [];
  const ends: EndTag[] = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    if (text.startsWith("<!--", lt)) {
      const close = text.indexOf("-->", lt + 4);
      i = close === -1 ? text.length : close + 3;
      continue;
    }
    if (text[lt + 1] === "!" || text[lt + 1] === "?") {
      const close = text.indexOf(">", lt);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (text[lt + 1] === "/") {
      const m = /^<\/([A-Za-z][A-Za-z0-9\-]*)\s*>/.exec(text.slice(lt, lt + 80));
      if (m && m[1]) {
        ends.push({ name: m[1].toLowerCase(), start: lt, end: lt + m[0].length });
        i = lt + m[0].length;
      } else i = lt + 2;
      continue;
    }
    if (!/[A-Za-z]/.test(text[lt + 1] ?? "")) {
      i = lt + 1;
      continue;
    }
    const tag = parseStartTagAt(text, lt, dialect);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    starts.push(tag);
    i = tag.end;
    const lower = tag.name.toLowerCase();
    if (dialect === "html" && RAW_TEXT.has(lower) && !tag.selfClosing) {
      const re = new RegExp(`</${lower}\\s*>`, "ig");
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        ends.push({ name: lower, start: m.index, end: m.index + m[0].length });
        i = m.index + m[0].length;
      } else i = text.length;
    }
  }
  return { starts, ends };
}

/** Finds the end tag that closes `tag` in an HTML document, tracking nesting by name. */
export function findMatchingEnd(text: string, tag: StartTag, dialect: Dialect = "html"): EndTag | null {
  if (tag.selfClosing || (dialect === "html" && isVoidElement(tag.name))) return null;
  const name = tag.name.toLowerCase();
  const { starts, ends } = scanHtml(text, dialect);
  const events = [
    ...starts.filter((s) => s.name.toLowerCase() === name && s.start > tag.start && !s.selfClosing).map((s) => ({ at: s.start, open: true, end: null as EndTag | null })),
    ...ends.filter((e) => e.name === name && e.start > tag.start).map((e) => ({ at: e.start, open: false, end: e })),
  ].sort((a, b) => a.at - b.at);
  let depth = 0;
  for (const ev of events) {
    if (ev.open) depth++;
    else if (depth === 0) return ev.end;
    else depth--;
  }
  return null;
}

/** Builds a fast offset to line and column lookup. Lines and columns are 1-based. */
export function lineIndex(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset: number) => {
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  };
}

export function getAttr(tag: StartTag, name: string): AttrToken | undefined {
  const lower = name.toLowerCase();
  return tag.attrs.find((a) => a.name.toLowerCase() === lower);
}

/**
 * Adds data-awb-loc="start-end-line-column" as the first attribute of every
 * start tag so findings in the sandbox can be traced back to source. The
 * stamp goes first so it survives the engine's truncated HTML snippets.
 */
export function instrumentHtml(text: string): string {
  const { starts } = scanHtml(text);
  const pos = lineIndex(text);
  let out = "";
  let cursor = 0;
  for (const tag of starts) {
    const insertAt = tag.start + 1 + tag.name.length;
    const { line, column } = pos(tag.start);
    out += text.slice(cursor, insertAt) + ` data-awb-loc="${tag.start}-${tag.end}-${line}-${column}"`;
    cursor = insertAt;
  }
  return out + text.slice(cursor);
}

/** True when the HTML is a full document rather than a fragment. */
export function isFullDocument(text: string): boolean {
  return /<html[\s>]/i.test(text) || /<!doctype html/i.test(text);
}
