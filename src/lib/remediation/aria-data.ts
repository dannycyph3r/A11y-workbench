/** WAI-ARIA 1.2 states and properties. */
export const ARIA_ATTRIBUTES = [
  "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel", "aria-brailleroledescription", "aria-busy",
  "aria-checked", "aria-colcount", "aria-colindex", "aria-colindextext", "aria-colspan", "aria-controls", "aria-current",
  "aria-describedby", "aria-description", "aria-details", "aria-disabled", "aria-dropeffect", "aria-errormessage",
  "aria-expanded", "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts",
  "aria-label", "aria-labelledby", "aria-level", "aria-live", "aria-modal", "aria-multiline", "aria-multiselectable",
  "aria-orientation", "aria-owns", "aria-placeholder", "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant",
  "aria-required", "aria-roledescription", "aria-rowcount", "aria-rowindex", "aria-rowindextext", "aria-rowspan",
  "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow", "aria-valuetext",
];

/** Concrete (non-abstract) WAI-ARIA 1.2 roles plus common DPUB and graphics roles. */
export const ARIA_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell", "checkbox", "code",
  "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion", "dialog", "directory", "document",
  "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list",
  "listbox", "listitem", "log", "main", "mark", "marquee", "math", "menu", "menubar", "menuitem", "menuitemcheckbox",
  "menuitemradio", "meter", "navigation", "none", "note", "option", "paragraph", "presentation", "progressbar", "radio",
  "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider",
  "spinbutton", "status", "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term",
  "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem", "graphics-document", "graphics-object",
  "graphics-symbol", "doc-abstract", "doc-acknowledgments", "doc-afterword", "doc-appendix", "doc-backlink", "doc-chapter",
  "doc-conclusion", "doc-credit", "doc-dedication", "doc-endnotes", "doc-epilogue", "doc-example", "doc-footnote",
  "doc-glossary", "doc-index", "doc-introduction", "doc-noteref", "doc-notice", "doc-pagebreak", "doc-part", "doc-preface",
  "doc-prologue", "doc-pullquote", "doc-qna", "doc-subtitle", "doc-tip", "doc-toc",
];

/** HTML autofill field names (the tokens most forms use). */
export const AUTOCOMPLETE_TOKENS = [
  "off", "on", "name", "honorific-prefix", "given-name", "additional-name", "family-name", "honorific-suffix", "nickname",
  "email", "username", "new-password", "current-password", "one-time-code", "organization-title", "organization",
  "street-address", "address-line1", "address-line2", "address-line3", "address-level4", "address-level3", "address-level2",
  "address-level1", "country", "country-name", "postal-code", "cc-name", "cc-given-name", "cc-additional-name",
  "cc-family-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type", "transaction-currency",
  "transaction-amount", "language", "bday", "bday-day", "bday-month", "bday-year", "sex", "url", "photo", "tel",
  "tel-country-code", "tel-national", "tel-area-code", "tel-local", "tel-extension", "impp", "webauthn",
];

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** The single closest candidate within `maxDistance`, or null if none or tied. */
export function closest(value: string, candidates: string[], maxDistance = 2): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  let tie = false;
  for (const c of candidates) {
    const d = levenshtein(value.toLowerCase(), c);
    if (d < bestD) {
      best = c;
      bestD = d;
      tie = false;
    } else if (d === bestD) tie = true;
  }
  return best && bestD <= maxDistance && !tie ? best : null;
}
