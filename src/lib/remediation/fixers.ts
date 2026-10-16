/**
 * Deterministic fixers. Each takes one finding and the document it came
 * from and returns exact text edits, or null when no safe edit exists.
 * Fixers never invent content: where meaning matters (alt text, names,
 * labels, titles) they ask the person for it through `inputs`.
 */
import { parseColor, sameColor, type RGBA } from "@/lib/contrast/color";
import { contrastRatio, suggestForeground } from "@/lib/contrast/contrast";
import { parseCss, rulesFromHtml, type CssDeclaration, type CssRule } from "@/lib/source/css";
import { findMatchingEnd, getAttr, parseStartTagAt, scanHtml, type AttrToken, type Dialect, type StartTag } from "@/lib/source/tags";
import type { Finding, FixConfidence, RemediationDocument } from "@/lib/findings/types";
import type { TextEdit } from "./edits";
import { ARIA_ATTRIBUTES, ARIA_ROLES, AUTOCOMPLETE_TOKENS, closest } from "./aria-data";

export interface FixInputSpec {
  key: string;
  label: string;
  help?: string;
  type: "text" | "checkbox";
  defaultValue?: string;
  /** When true the fix produces no edits until this input has a value. */
  required?: boolean;
}

export interface ColorChange {
  property: string;
  from: string;
  to: string;
  background: string;
  ratioBefore?: number;
  ratioAfter: number;
  required: number;
  deltaE: number;
  direction: "darker" | "lighter";
}

export interface ProposedFix {
  findingId: string;
  ruleId: string;
  summary: string;
  rationale: string;
  confidence: FixConfidence;
  edits: TextEdit[];
  inputs: FixInputSpec[];
  needsInput: boolean;
  color?: ColorChange;
  warnings: string[];
}

export interface FixContext {
  doc: RemediationDocument;
  finding: Finding;
  inputs: Record<string, string>;
  settings: { defaultLang: string };
}

type Fixer = (ctx: FixContext) => Omit<ProposedFix, "findingId" | "ruleId"> | null;

// ---- helpers -------------------------------------------------------------

const JSX_NAMES: Record<string, string> = { for: "htmlFor", class: "className", tabindex: "tabIndex", autocomplete: "autoComplete", readonly: "readOnly" };

function attrName(name: string, dialect: Dialect): string {
  return dialect === "jsx" ? (JSX_NAMES[name] ?? name) : name;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function attrText(name: string, value: string, dialect: Dialect): string {
  const n = attrName(name, dialect);
  if (dialect === "jsx") return value.includes('"') || value.includes("{") ? `${n}={${JSON.stringify(value)}}` : `${n}="${value}"`;
  return `${n}="${escapeHtml(value)}"`;
}

function textContent(s: string, dialect: Dialect): string {
  return dialect === "jsx" ? s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`) : escapeHtml(s);
}

function findAttr(tag: StartTag, name: string, dialect: Dialect): AttrToken | undefined {
  return getAttr(tag, name) ?? (dialect === "jsx" ? getAttr(tag, attrName(name, dialect)) : undefined);
}

function setAttr(tag: StartTag, name: string, value: string, dialect: Dialect): TextEdit {
  const existing = findAttr(tag, name, dialect);
  const text = attrText(name, value, dialect);
  if (existing) return { start: existing.start, end: existing.end, replacement: text };
  return { start: tag.insertAt, end: tag.insertAt, replacement: ` ${text}` };
}

function removeAttr(text: string, attr: AttrToken): TextEdit {
  let s = attr.start;
  while (s > 0 && /\s/.test(text[s - 1]!)) s--;
  return { start: s, end: attr.end, replacement: "" };
}

function dialectOf(doc: RemediationDocument): Dialect {
  return doc.dialect === "jsx" ? "jsx" : "html";
}

/** The start tag a finding points at, or null when the location does not line up. */
function tagAt(ctx: FixContext): StartTag | null {
  const loc = ctx.finding.node.location;
  if (!loc || ctx.doc.dialect === "css") return null;
  const tag = parseStartTagAt(ctx.doc.text, loc.start, dialectOf(ctx.doc));
  if (!tag || tag.end !== loc.end) return null;
  return tag;
}

const input = (ctx: FixContext, key: string) => (ctx.inputs[key] ?? "").trim();

function nameInputFix(
  ctx: FixContext,
  opts: { attr: string; label: string; help: string; summary: (v: string) => string; rationale: string },
): ReturnType<Fixer> {
  const tag = tagAt(ctx);
  if (!tag) return null;
  const value = input(ctx, "name");
  return {
    summary: value ? opts.summary(value) : `Add ${opts.attr} once you provide the text`,
    rationale: opts.rationale,
    confidence: "manual",
    edits: value ? [setAttr(tag, opts.attr, value, dialectOf(ctx.doc))] : [],
    inputs: [{ key: "name", label: opts.label, help: opts.help, type: "text", required: true }],
    needsInput: !value,
    warnings: [],
  };
}

// ---- colour --------------------------------------------------------------

const COLOR_DECL = /(^|[\s;{'"(,])color\s*:\s*/gi;

/** Finds a `color:` value inside [from, to) whose parsed colour matches `fg` (or any, if fg is null). */
function findColorValue(text: string, from: number, to: number, fg: RGBA | null): { start: number; end: number; value: string } | null {
  const slice = text.slice(from, to);
  COLOR_DECL.lastIndex = 0;
  let m: RegExpExecArray | null;
  let fallback: { start: number; end: number; value: string } | null = null;
  while ((m = COLOR_DECL.exec(slice))) {
    let i = m.index + m[0].length;
    let quote = "";
    if (slice[i] === "'" || slice[i] === '"') quote = slice[i++]!;
    const vStart = i;
    while (i < slice.length) {
      const c = slice[i]!;
      if (quote ? c === quote : c === ";" || c === "}" || c === '"' || c === "'" || c === "\n" || c === ",") break;
      if (c === "(") {
        const close = slice.indexOf(")", i);
        i = close === -1 ? slice.length : close + 1;
        continue;
      }
      i++;
    }
    let raw = slice.slice(vStart, i);
    const important = /\s*!important\s*$/i.exec(raw);
    if (important) raw = raw.slice(0, important.index);
    const value = raw.trim();
    const hit = { start: from + vStart, end: from + vStart + value.length, value };
    const parsed = parseColor(value);
    if (fg && parsed && sameColor({ ...parsed, a: parsed.a }, fg)) return hit;
    fallback ??= parsed ? hit : null;
  }
  return fg ? null : fallback;
}

const normSel = (s: string) => s.replace(/\s+/g, " ").replace(/\s*([>+~,])\s*/g, "$1").trim();

function docRules(doc: RemediationDocument): CssRule[] {
  return doc.dialect === "css" ? parseCss(doc.text) : doc.dialect === "html" ? rulesFromHtml(doc.text) : [];
}

const contrastFix: Fixer = (ctx) => {
  const ev = ctx.finding.node.contrast;
  if (!ev?.foreground || !ev.background) return null;
  const fg = parseColor(ev.foreground);
  const bg = parseColor(ev.background);
  if (!fg || !bg || bg.a < 1) return null;
  const suggestion = suggestForeground(fg, bg, ev.required);
  if (!suggestion) return null;
  const color: ColorChange = {
    property: "color",
    from: ev.foreground,
    to: suggestion.hex,
    background: ev.background,
    ratioBefore: ev.ratio ?? contrastRatio({ ...fg, a: 1 }, bg),
    ratioAfter: suggestion.ratio,
    required: ev.required,
    deltaE: suggestion.deltaE,
    direction: suggestion.direction,
  };
  const warnings: string[] = [];
  let target: { start: number; end: number; value: string } | null = null;
  const src = ev.colorSource;

  // 1. Inline style on the element itself.
  const tag = tagAt(ctx);
  const styleAttr = tag ? findAttr(tag, "style", dialectOf(ctx.doc)) : undefined;
  if (styleAttr?.valueStart !== undefined && styleAttr.valueEnd !== undefined) {
    target = findColorValue(ctx.doc.text, styleAttr.valueStart, styleAttr.valueEnd, src?.kind === "inline" ? null : fg);
  }
  // 2. The stylesheet rule the browser reported, or for static CSS findings the rule at the location.
  if (!target) {
    const rules = docRules(ctx.doc);
    let candidates: CssRule[] = [];
    if (ctx.finding.source === "static-css" && ctx.finding.node.location) {
      candidates = rules.filter((r) => r.selectorStart === ctx.finding.node.location!.start);
    } else if (src?.kind === "rule" && src.selector) {
      candidates = rules.filter((r) => normSel(r.selector) === normSel(src.selector!));
    }
    for (const rule of [...candidates].reverse()) {
      target = findColorValue(ctx.doc.text, rule.blockStart, rule.blockEnd, fg) ?? findColorValue(ctx.doc.text, rule.blockStart, rule.blockEnd, null);
      if (target) {
        if (rule.selector.includes(",") || !/^#/.test(rule.selector.trim())) {
          warnings.push(`This changes the rule "${rule.selector}", which may style other elements as well.`);
        }
        break;
      }
    }
  }
  if (fg.a < 1) warnings.push("The original colour was translucent. The proposal is an opaque colour measured against the resolved background.");
  if (!target) {
    return {
      summary: `Change the text colour to ${suggestion.hex}`,
      rationale:
        "The declaration that sets this colour is not in the submitted document (it may come from an external stylesheet or a parent element), so no patch can be generated. Apply the suggested value where the colour is defined.",
      confidence: "manual",
      edits: [],
      inputs: [],
      needsInput: false,
      color,
      warnings,
    };
  }
  return {
    summary: `Change ${target.value} to ${suggestion.hex}`,
    rationale: `Keeps the hue and moves lightness ${suggestion.direction === "darker" ? "down" : "up"} by the smallest step that meets ${ev.required}:1 against ${ev.background}.`,
    confidence: "review",
    edits: [{ start: target.start, end: target.end, replacement: suggestion.hex }],
    inputs: [],
    needsInput: false,
    color,
    warnings,
  };
};

// ---- focus ---------------------------------------------------------------

export const FOCUS_RULE = `
/* Focus indicator proposed by A11y. Match the colour to your palette
   and confirm it reaches 3:1 against every background it appears on. */
:where(a[href], button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
`;

function removeDeclaration(text: string, decl: CssDeclaration): TextEdit {
  let end = decl.end;
  while (end < text.length && /[ \t]/.test(text[end]!)) end++;
  if (text[end] === ";") end++;
  let start = decl.start;
  while (start > 0 && /[ \t]/.test(text[start - 1]!)) start--;
  if (text[start - 1] === "\n" && text[end] === "\n") end++;
  return { start, end, replacement: "" };
}

const focusFix: Fixer = (ctx) => {
  const { doc, finding } = ctx;
  if (doc.dialect === "jsx") return null;
  // Prefer removing the declaration that suppresses the outline, when it can be found.
  if (finding.ruleId === "awb-outline-suppressed") {
    const rules = docRules(doc).filter((r) =>
      finding.source === "static-css" && finding.node.location ? r.selectorStart === finding.node.location.start : normSel(r.selector) === normSel(finding.node.selector),
    );
    for (const rule of rules) {
      const decl = rule.declarations.find(
        (d) => (d.property === "outline" && /^(none|0(px)?)/i.test(d.value)) || (d.property === "outline-style" && /^none/i.test(d.value)) || (d.property === "outline-width" && /^0/.test(d.value)),
      );
      if (decl) {
        return {
          summary: `Remove "${decl.property}: ${decl.value}" from ${rule.selector}`,
          rationale: "Restores the browser's own focus indicator, which is visible by default.",
          confidence: "review",
          edits: [removeDeclaration(doc.text, decl)],
          inputs: [],
          needsInput: false,
          warnings: ["If the outline was removed for mouse users, add a :focus-visible style instead so keyboard users still see focus."],
        };
      }
    }
  }
  if (doc.dialect === "css") {
    return {
      summary: "Append a :focus-visible rule",
      rationale: "Adds a visible outline for keyboard focus without changing mouse interaction.",
      confidence: "review",
      edits: [{ start: doc.text.length, end: doc.text.length, replacement: FOCUS_RULE }],
      inputs: [],
      needsInput: false,
      warnings: ["Rules with higher specificity that set outline: none will still win. The verification rerun will show whether it took effect."],
    };
  }
  const headClose = doc.text.search(/<\/head\s*>/i);
  const at = headClose === -1 ? 0 : headClose;
  return {
    summary: "Add a :focus-visible style block",
    rationale: "Adds a visible outline for keyboard focus without changing mouse interaction.",
    confidence: "review",
    edits: [{ start: at, end: at, replacement: `<style>${FOCUS_RULE}</style>\n` }],
    inputs: [],
    needsInput: false,
    warnings: [
      "Rules with higher specificity that set outline: none will still win. The verification rerun will show whether it took effect.",
      "currentColor follows the text colour; confirm it reaches 3:1 against the background.",
    ],
  };
};

// ---- native element swap -------------------------------------------------

const INTERACTIVE_INSIDE = /<(a\s[^>]*href|button|input|select|textarea)\b/i;

const nativeButtonFix: Fixer = (ctx) => {
  const tag = tagAt(ctx);
  const dialect = dialectOf(ctx.doc);
  if (!tag || !["div", "span"].includes(tag.name.toLowerCase())) return null;
  const end = findMatchingEnd(ctx.doc.text, tag, dialect);
  if (!end) return null;
  if (INTERACTIVE_INSIDE.test(ctx.doc.text.slice(tag.end, end.start))) return null;
  const keep = tag.attrs.filter((a) => {
    const n = a.name.toLowerCase();
    if (n === "role" || n === "type") return false;
    if ((n === "tabindex" || n === "tabIndex".toLowerCase()) && a.value !== null && Number(a.value.replace(/[{}]/g, "")) >= 0) return false;
    return true;
  });
  const attrTexts = [`type="button"`, ...keep.map((a) => ctx.doc.text.slice(a.start, a.end)), ...tag.spreads.map((s) => ctx.doc.text.slice(s.start, s.end))];
  const replacement = `<button ${attrTexts.join(" ")}${tag.selfClosing ? " /" : ""}>`;
  return {
    summary: `Replace <${tag.name}> with a native <button>`,
    rationale: "A native button is focusable and responds to Enter and Space without extra script, and announces itself as a button.",
    confidence: "review",
    edits: [
      { start: tag.start, end: tag.end, replacement },
      { start: end.start, end: end.end, replacement: "</button>" },
    ],
    inputs: [],
    needsInput: false,
    warnings: [
      "Buttons carry default browser styles. Reset them in CSS if the design relied on the old element.",
      "Remove any custom key handlers for Enter and Space; the native button already fires click for both.",
    ],
  };
};

// ---- registry ------------------------------------------------------------

export const FIXERS: Record<string, Fixer> = {
  "color-contrast": contrastFix,
  "awb-css-contrast": contrastFix,

  "meta-viewport": (ctx) => {
    const tag = tagAt(ctx);
    const content = tag ? getAttr(tag, "content") : undefined;
    if (!tag || !content?.value || content.valueStart === undefined) return null;
    const parts = content.value.split(",").map((p) => p.trim()).filter(Boolean);
    const kept = parts.filter((p) => {
      const [k, v] = p.split("=").map((s) => s.trim().toLowerCase());
      if (k === "user-scalable" && (v === "no" || v === "0")) return false;
      if (k === "maximum-scale" && Number(v) < 2) return false;
      return true;
    });
    return {
      summary: `Change the viewport to "${kept.join(", ")}"`,
      rationale: "Removes the settings that block pinch zoom. Nothing else about the layout changes.",
      confidence: "high",
      edits: [{ start: content.valueStart, end: content.valueEnd!, replacement: kept.join(", ") }],
      inputs: [],
      needsInput: false,
      warnings: [],
    };
  },

  "html-has-lang": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag || tag.name.toLowerCase() !== "html") return null;
    const lang = input(ctx, "lang") || ctx.settings.defaultLang;
    return {
      summary: `Add lang="${lang}" to <html>`,
      rationale: "Tells assistive technology which pronunciation rules to use for the page.",
      confidence: "review",
      edits: [setAttr(tag, "lang", lang, "html")],
      inputs: [{ key: "lang", label: "Page language (BCP 47 tag)", help: "For example en, fr or en-CA. Defaults to your Settings value.", type: "text", defaultValue: ctx.settings.defaultLang }],
      needsInput: false,
      warnings: ["Confirm the code matches the language the page is written in."],
    };
  },

  "html-lang-valid": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag) return null;
    const lang = input(ctx, "lang") || ctx.settings.defaultLang;
    return {
      summary: `Change the lang value to "${lang}"`,
      rationale: "Replaces an unrecognised language code with a valid one.",
      confidence: "review",
      edits: [setAttr(tag, "lang", lang, "html")],
      inputs: [{ key: "lang", label: "Page language (BCP 47 tag)", type: "text", defaultValue: ctx.settings.defaultLang }],
      needsInput: false,
      warnings: [],
    };
  },

  "html-xml-lang-mismatch": (ctx) => {
    const tag = tagAt(ctx);
    const lang = tag ? getAttr(tag, "lang")?.value : undefined;
    if (!tag || !lang) return null;
    return {
      summary: `Set xml:lang to "${lang}"`,
      rationale: "Makes the two language declarations agree.",
      confidence: "high",
      edits: [setAttr(tag, "xml:lang", lang, "html")],
      inputs: [],
      needsInput: false,
      warnings: [],
    };
  },

  "document-title": (ctx) => {
    if (ctx.doc.dialect !== "html") return null;
    const title = input(ctx, "title");
    const inputs: FixInputSpec[] = [{ key: "title", label: "Page title", help: "Name the page's topic or purpose, for example \"Book an appointment, Maple Ridge Clinic\".", type: "text", required: true }];
    if (!title) return { summary: "Add a <title> once you provide the text", rationale: "Only you know what the page is for.", confidence: "manual", edits: [], inputs, needsInput: true, warnings: [] };
    const { starts } = scanHtml(ctx.doc.text);
    const titleTag = starts.find((s) => s.name.toLowerCase() === "title");
    const head = starts.find((s) => s.name.toLowerCase() === "head");
    const html = starts.find((s) => s.name.toLowerCase() === "html");
    let edit: TextEdit;
    if (titleTag) {
      const close = ctx.doc.text.toLowerCase().indexOf("</title", titleTag.end);
      edit = { start: titleTag.end, end: close === -1 ? titleTag.end : close, replacement: escapeHtml(title) };
    } else if (head) edit = { start: head.end, end: head.end, replacement: `\n  <title>${escapeHtml(title)}</title>` };
    else if (html) edit = { start: html.end, end: html.end, replacement: `\n<head><title>${escapeHtml(title)}</title></head>` };
    else return null;
    return { summary: `Set the page title to "${title}"`, rationale: "The title is announced first by screen readers and labels the browser tab.", confidence: "manual", edits: [edit], inputs, needsInput: false, warnings: [] };
  },

  "image-alt": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag) return null;
    const isImg = tag.name.toLowerCase() === "img";
    const decorative = ctx.inputs.decorative === "true";
    const alt = input(ctx, "alt");
    const inputs: FixInputSpec[] = [
      { key: "alt", label: "Alt text", help: "Say what the image communicates here, not what it looks like. Skip words like \"image of\".", type: "text" },
      ...(isImg ? [{ key: "decorative", label: "This image is decorative (adds nothing a reader would miss)", type: "checkbox" as const }] : []),
    ];
    const attr = isImg ? "alt" : "aria-label";
    if (decorative && isImg) {
      return { summary: 'Mark as decorative with alt=""', rationale: "An empty alt tells screen readers to skip the image.", confidence: "manual", edits: [setAttr(tag, "alt", "", dialectOf(ctx.doc))], inputs, needsInput: false, warnings: [] };
    }
    if (!alt) return { summary: "Add alt text once you provide it", rationale: "Only someone who knows why the image is there can describe it.", confidence: "manual", edits: [], inputs, needsInput: true, warnings: [] };
    return { summary: `Add ${attr}="${alt}"`, rationale: "Gives the image a text alternative that assistive technology announces.", confidence: "manual", edits: [setAttr(tag, attr, alt, dialectOf(ctx.doc))], inputs, needsInput: false, warnings: [] };
  },

  "input-image-alt": (ctx) => nameInputFix(ctx, { attr: "alt", label: "Button action", help: "The word on the button, for example \"Search\".", summary: (v) => `Add alt="${v}"`, rationale: "An image button announces its alt text as its name." }),
  "role-img-alt": (ctx) => nameInputFix(ctx, { attr: "aria-label", label: "Image description", help: "What the image communicates.", summary: (v) => `Add aria-label="${v}"`, rationale: "role=\"img\" elements take their name from aria-label." }),
  "svg-img-alt": (ctx) => nameInputFix(ctx, { attr: "aria-label", label: "Graphic description", help: "What the graphic communicates.", summary: (v) => `Add aria-label="${v}"`, rationale: "An SVG with role=\"img\" needs an accessible name." }),
  "button-name": (ctx) => nameInputFix(ctx, { attr: "aria-label", label: "What the button does", help: "A short verb phrase, for example \"Close dialog\" or \"Search\".", summary: (v) => `Add aria-label="${v}"`, rationale: "Gives an icon-only button a name. Visible text inside the button is better when the design allows it." }),
  "link-name": (ctx) => nameInputFix(ctx, { attr: "aria-label", label: "Where the link goes", help: "Name the destination, for example \"Clinic home\".", summary: (v) => `Add aria-label="${v}"`, rationale: "Gives an icon-only link a name. Visible link text is better when the design allows it." }),
  "aria-command-name": (ctx) => nameInputFix(ctx, { attr: "aria-label", label: "What the control does", help: "A short verb phrase.", summary: (v) => `Add aria-label="${v}"`, rationale: "Custom controls need an accessible name." }),
  "input-button-name": (ctx) => nameInputFix(ctx, { attr: "value", label: "Button text", help: "The visible text, which is also its name.", summary: (v) => `Add value="${v}"`, rationale: "An input button shows and announces its value." }),
  "frame-title": (ctx) => nameInputFix(ctx, { attr: "title", label: "What the frame contains", help: "For example \"Clinic location map\".", summary: (v) => `Add title="${v}"`, rationale: "The title tells screen reader users what is inside before they enter it." }),

  label: (ctx) => labelFix(ctx),
  "select-name": (ctx) => labelFix(ctx),

  "aria-valid-attr": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag) return null;
    const bad = tag.attrs.filter((a) => a.name.toLowerCase().startsWith("aria-") && !ARIA_ATTRIBUTES.includes(a.name.toLowerCase()));
    if (!bad.length) return null;
    const edits: TextEdit[] = [];
    const notes: string[] = [];
    for (const a of bad) {
      const fix = closest(a.name, ARIA_ATTRIBUTES);
      if (fix) {
        edits.push({ start: a.start, end: a.start + a.name.length, replacement: fix });
        notes.push(`${a.name} to ${fix}`);
      } else {
        edits.push(removeAttr(ctx.doc.text, a));
        notes.push(`remove ${a.name}`);
      }
    }
    return { summary: `Correct ARIA attributes: ${notes.join(", ")}`, rationale: "Browsers ignore unknown aria-* attributes, so the intended meaning never reaches assistive technology.", confidence: "review", edits, inputs: [], needsInput: false, warnings: ["Check the corrected attribute expresses what was intended."] };
  },

  "aria-roles": (ctx) => {
    const tag = tagAt(ctx);
    const role = tag ? getAttr(tag, "role") : undefined;
    if (!tag || !role?.value || role.valueStart === undefined) return null;
    const tokens = role.value.split(/\s+/).filter(Boolean);
    const fixed = tokens.map((t) => (ARIA_ROLES.includes(t.toLowerCase()) ? t : closest(t, ARIA_ROLES))).filter((t): t is string => Boolean(t));
    const edit = fixed.length ? { start: role.valueStart, end: role.valueEnd!, replacement: fixed.join(" ") } : removeAttr(ctx.doc.text, role);
    return {
      summary: fixed.length ? `Change role to "${fixed.join(" ")}"` : "Remove the invalid role",
      rationale: "An invalid role is ignored or misreported. Native HTML elements are usually a better choice than a role.",
      confidence: "review",
      edits: [edit],
      inputs: [],
      needsInput: false,
      warnings: [],
    };
  },

  tabindex: (ctx) => {
    const tag = tagAt(ctx);
    const ti = tag ? findAttr(tag, "tabindex", dialectOf(ctx.doc)) : undefined;
    if (!tag || !ti) return null;
    return { summary: 'Set tabindex="0"', rationale: "Puts the element back in the natural focus order. Rearrange the markup if a different order is needed.", confidence: "review", edits: [setAttr(tag, "tabindex", "0", dialectOf(ctx.doc))], inputs: [], needsInput: false, warnings: ["The focus order will follow the DOM order after this change."] };
  },

  "scrollable-region-focusable": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag) return null;
    return { summary: 'Add tabindex="0" to the scrollable region', rationale: "Lets keyboard users focus the region and scroll it with the arrow keys.", confidence: "review", edits: [setAttr(tag, "tabindex", "0", dialectOf(ctx.doc))], inputs: [], needsInput: false, warnings: ["Give the region an accessible name (for example aria-label) so focus announces what it is."] };
  },

  "aria-hidden-body": (ctx) => {
    const tag = tagAt(ctx);
    const attr = tag ? getAttr(tag, "aria-hidden") : undefined;
    if (!tag || !attr) return null;
    return { summary: "Remove aria-hidden from <body>", rationale: "aria-hidden on body hides the entire page from assistive technology.", confidence: "high", edits: [removeAttr(ctx.doc.text, attr)], inputs: [], needsInput: false, warnings: [] };
  },

  "autocomplete-valid": (ctx) => {
    const tag = tagAt(ctx);
    const ac = tag ? findAttr(tag, "autocomplete", dialectOf(ctx.doc)) : undefined;
    if (!tag || !ac?.value) return null;
    const tokens = ac.value.trim().split(/\s+/);
    const lastToken = tokens[tokens.length - 1]!;
    const fix = closest(lastToken, AUTOCOMPLETE_TOKENS);
    if (!fix) return null;
    tokens[tokens.length - 1] = fix;
    return { summary: `Change autocomplete to "${tokens.join(" ")}"`, rationale: "Uses a token browsers and assistive tools recognise.", confidence: "review", edits: [setAttr(tag, "autocomplete", tokens.join(" "), dialectOf(ctx.doc))], inputs: [], needsInput: false, warnings: ["Confirm the token matches what the field collects."] };
  },

  "target-size": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag || ctx.doc.dialect !== "html") return null;
    const style = getAttr(tag, "style");
    const add = "min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center;";
    const edit = style?.value !== undefined && style.value !== null && style.valueStart !== undefined
      ? { start: style.valueEnd!, end: style.valueEnd!, replacement: `${style.value.trim().endsWith(";") || !style.value.trim() ? "" : ";"} ${add}`.trimStart() }
      : setAttr(tag, "style", add, "html");
    return { summary: "Give the target a 24 by 24 pixel minimum", rationale: "Meets WCAG 2.2 target size (minimum) by size rather than spacing.", confidence: "review", edits: [edit], inputs: [], needsInput: false, warnings: ["An inline style is the quickest proof; move it into your stylesheet.", "Check the layout around the target still works."] };
  },

  "awb-role-button-div": nativeButtonFix,
  "awb-clickable-not-focusable": nativeButtonFix,
  "awb-outline-suppressed": focusFix,
  "awb-focus-not-visible": focusFix,

  "awb-paste-blocked": (ctx) => {
    const tag = tagAt(ctx);
    const attr = tag ? findAttr(tag, "onpaste", dialectOf(ctx.doc)) ?? findAttr(tag, "onPaste", dialectOf(ctx.doc)) : undefined;
    if (!tag || !attr) return null;
    return { summary: "Remove the onpaste handler", rationale: "Lets people paste credentials and use password managers (WCAG 2.2, 3.3.8).", confidence: "high", edits: [removeAttr(ctx.doc.text, attr)], inputs: [], needsInput: false, warnings: [] };
  },

  "awb-password-autocomplete-off": (ctx) => {
    const tag = tagAt(ctx);
    if (!tag) return null;
    const token = input(ctx, "token") || "current-password";
    return {
      summary: `Set autocomplete="${token}"`,
      rationale: "Lets password managers fill the field.",
      confidence: "review",
      edits: [setAttr(tag, "autocomplete", token, dialectOf(ctx.doc))],
      inputs: [{ key: "token", label: "Autocomplete token", help: "current-password for sign-in, new-password for sign-up or change.", type: "text", defaultValue: "current-password" }],
      needsInput: false,
      warnings: [],
    };
  },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "field";
}

function labelFix(ctx: FixContext): ReturnType<Fixer> {
  const tag = tagAt(ctx);
  if (!tag) return null;
  const dialect = dialectOf(ctx.doc);
  const text = input(ctx, "label");
  const inputs: FixInputSpec[] = [{ key: "label", label: "Label text", help: "Visible text that says what to enter, for example \"Health card number\".", type: "text", required: true }];
  if (!text) return { summary: "Add a <label> once you provide the text", rationale: "Only you know what the field collects.", confidence: "manual", edits: [], inputs, needsInput: true, warnings: [] };
  const edits: TextEdit[] = [];
  let id = findAttr(tag, "id", dialect)?.value ?? null;
  if (!id || id.startsWith("{")) {
    const base = slugify(text);
    id = base;
    for (let n = 2; ctx.doc.text.includes(`id="${id}"`); n++) id = `${base}-${n}`;
    edits.push(setAttr(tag, "id", id, dialect));
  }
  edits.push({ start: tag.start, end: tag.start, replacement: `<label ${attrText("for", id, dialect)}>${textContent(text, dialect)}</label>\n` });
  return {
    summary: `Add <label for="${id}">${text}</label>`,
    rationale: "A native label is announced with the field and enlarges the click target. Placeholder text is not a substitute.",
    confidence: "manual",
    edits,
    inputs,
    needsInput: false,
    warnings: ["The label is inserted directly before the field. Move it if your layout puts labels elsewhere."],
  };
}

export function hasFixer(ruleId: string): boolean {
  return ruleId in FIXERS;
}
