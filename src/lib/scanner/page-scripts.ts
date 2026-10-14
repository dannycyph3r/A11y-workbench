/**
 * Scripts evaluated inside the scanned page. They are kept as plain
 * JavaScript strings so no bundler can inject helpers that do not exist
 * in the page. Each is an expression taking one JSON argument.
 */

/** Shared helpers prepended to each script. */
const HELPERS = String.raw`
  const cssPath = (el) => {
    if (!(el instanceof Element)) return "";
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.localName;
      if (cur.id && document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === cur.localName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.length ? parts.join(' > ') : 'html';
  };
  const startTag = (el) => {
    const html = el.outerHTML || '';
    const close = html.indexOf('>');
    return (close === -1 ? html : html.slice(0, close + 1)).slice(0, 600);
  };
  const FOCUSABLE = 'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable=true], audio[controls], video[controls]';
  const isFocusable = (el) => el.matches(FOCUSABLE) && !el.matches('[disabled]');
`;

/** Structural heuristics that read markup and computed styles. */
export const PAGE_FACTS = String.raw`(() => {
  ${HELPERS}
  const out = [];
  const warnings = [];
  const push = (ruleId, kind, impact, el, evidence) => out.push({ ruleId, kind, impact, selector: cssPath(el), html: startTag(el), evidence });

  for (const el of document.querySelectorAll('[role="button"]')) {
    if (el.localName === 'button' || el.localName === 'input' || el.localName === 'a') continue;
    if (!['div', 'span'].includes(el.localName)) continue;
    const focusable = el.hasAttribute('tabindex');
    push('awb-role-button-div', 'heuristic', focusable ? 'moderate' : 'serious', el, [
      'A ' + el.localName + ' with role="button" re-creates a native button by hand.',
      focusable ? 'It is focusable, but Enter and Space need script support that cannot be confirmed statically.' : 'It has no tabindex, so keyboard users cannot reach it at all.',
    ]);
  }

  const interactiveAncestor = (el) => el.closest('a[href], button, label, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [role=checkbox], [role=switch], input, select, textarea');
  for (const el of document.querySelectorAll('body *')) {
    if (el.getAttribute('role') === 'button') continue;
    if (isFocusable(el)) continue;
    const hasHandler = el.hasAttribute('onclick') || el.hasAttribute('onmousedown') || el.hasAttribute('onmouseup');
    if (!hasHandler) continue;
    if (interactiveAncestor(el) && interactiveAncestor(el) !== el) continue;
    push('awb-clickable-not-focusable', 'heuristic', 'serious', el, [
      'The element has a ' + (el.hasAttribute('onclick') ? 'click' : 'mouse') + ' handler but is not focusable and has no interactive role.',
    ]);
  }

  for (const el of document.querySelectorAll('[draggable="true"], [ondragstart]')) {
    push('awb-dragging-alternative', 'needs-review', 'moderate', el, [
      'This element can be dragged. WCAG 2.2 requires a single-pointer alternative unless dragging is essential.',
    ]);
  }

  for (const el of document.querySelectorAll('input[type=password]')) {
    const paste = (el.getAttribute('onpaste') || '').toLowerCase();
    if (paste && (paste.includes('return false') || paste.includes('preventdefault'))) {
      push('awb-paste-blocked', 'heuristic', 'serious', el, ['The onpaste handler cancels paste on a password field.']);
    }
    if ((el.getAttribute('autocomplete') || '').toLowerCase() === 'off') {
      push('awb-password-autocomplete-off', 'heuristic', 'minor', el, ['autocomplete="off" is set on a password field.']);
    }
  }

  // Stylesheets that remove the focus outline with nothing in its place.
  const indicatorProps = ['box-shadow', 'border-top-color', 'border-top-style', 'border-top-width', 'background-color', 'text-decoration-line'];
  let restores = false;
  const suppressions = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { warnings.push('A cross-origin stylesheet could not be read: ' + (sheet.href || 'inline')); continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; }
        if (!rule.selectorText || !rule.style) continue;
        const sel = rule.selectorText;
        const os = rule.style.getPropertyValue('outline-style');
        const ow = rule.style.getPropertyValue('outline-width');
        const removed = os === 'none' || ow === '0px' || ow === '0';
        if (/:focus/.test(sel)) {
          if (!removed && (os || rule.style.getPropertyValue('outline'))) restores = true;
          if (rule.style.getPropertyValue('box-shadow')) restores = true;
        }
        if (removed && /:focus|(^|[\s,>+~])\*|(^|[\s,>+~(])(a|button|input|select|textarea|summary)\b|\[tabindex/i.test(sel)) {
          const hasAlt = indicatorProps.some((p) => rule.style.getPropertyValue(p));
          if (!hasAlt) suppressions.push({ sel, css: rule.cssText.slice(0, 400) });
        }
      }
    };
    walk(rules);
  }
  if (!restores) {
    for (const s of suppressions) {
      out.push({ ruleId: 'awb-outline-suppressed', kind: 'heuristic', impact: 'serious', selector: s.sel, html: s.css, evidence: ['The rule removes the outline for "' + s.sel + '" and adds no replacement indicator.', 'No focus or focus-visible rule on the page restores one.'] });
    }
  }
  return { results: out, warnings: [...new Set(warnings)] };
})()`;

/**
 * Records each focusable element's unfocused indicator styles in a page
 * WeakMap so the keyboard walk can compare focused against unfocused.
 */
export const RECORD_BASELINE = String.raw`(() => {
  ${HELPERS}
  const map = new WeakMap();
  const props = ['outline-style', 'outline-width', 'outline-color', 'box-shadow', 'border-top-color', 'border-bottom-color', 'border-bottom-width', 'background-color', 'color', 'text-decoration-line'];
  let n = 0;
  for (const el of document.querySelectorAll(FOCUSABLE)) {
    const cs = getComputedStyle(el);
    map.set(el, props.map((p) => cs.getPropertyValue(p)).join('|'));
    n++;
  }
  window.__awbBaseline = { map, props };
  return n;
})()`;

/** Inspects document.activeElement after a Tab press. */
export const PROBE_FOCUS = String.raw`(() => {
  ${HELPERS}
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { atBody: true };
  const base = window.__awbBaseline;
  const cs = getComputedStyle(el);
  const now = base ? base.props.map((p) => cs.getPropertyValue(p)).join('|') : '';
  const before = base ? base.map.get(el) : undefined;
  const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const changed = before !== undefined && before !== now;
  // Is the element fully covered by fixed or sticky content?
  const r = el.getBoundingClientRect();
  let obscured = false, coverSelector = '';
  if (r.width > 0 && r.height > 0) {
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]]
      .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    if (pts.length === 5) {
      let covered = 0;
      for (const [x, y] of pts) {
        const top = document.elementFromPoint(x, y);
        if (!top || el.contains(top) || top.contains(el)) continue;
        let cur = top, fixed = null;
        while (cur && cur !== document.body) {
          const pos = getComputedStyle(cur).position;
          if (pos === 'fixed' || pos === 'sticky') { fixed = cur; break; }
          cur = cur.parentElement;
        }
        if (fixed) { covered++; coverSelector = cssPath(fixed); }
      }
      obscured = covered === 5;
    }
  }
  const segmented = el.localName === 'input' && ['date', 'time', 'datetime-local', 'month', 'week'].includes(el.type);
  return {
    atBody: false,
    segmented,
    selector: cssPath(el),
    html: startTag(el),
    outlineVisible,
    changed,
    hadBaseline: before !== undefined,
    obscured,
    coverSelector,
  };
})()`;

/**
 * For contrast failures, finds where the text colour is declared: an
 * inline style on the element or an ancestor, or the most specific
 * matching stylesheet rule. Values are normalised by the browser.
 */
export const COLOR_SOURCES = String.raw`((selectors) => {
  const spec = (sel) => {
    const s = sel.replace(/::?[a-z-]+\([^)]*\)/g, (m) => m.startsWith('::') ? ' x' : ' .x').replace(/::[a-z-]+/g, ' x');
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
    const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
    return ids * 10000 + cls * 100 + types;
  };
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    const walk = (l) => { for (const r of l) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && r.style && r.style.getPropertyValue('color')) rules.push(r); } };
    walk(list);
  }
  const result = {};
  for (const selector of selectors) {
    if (selector.includes('>>>')) continue;
    let el; try { el = document.querySelector(selector); } catch { continue; }
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.style && cur.style.getPropertyValue('color')) { result[selector] = { kind: 'inline', value: cur.style.getPropertyValue('color') }; break; }
      let best = null, bestSpec = -1, bestSel = '';
      rules.forEach((r, i) => {
        for (const part of r.selectorText.split(',')) {
          const p = part.trim();
          let m = false; try { m = cur.matches(p); } catch {}
          if (m) { const sp = spec(p); if (sp >= bestSpec) { best = r; bestSpec = sp; bestSel = r.selectorText; } }
        }
      });
      if (best) { result[selector] = { kind: 'rule', selector: bestSel, value: best.style.getPropertyValue('color') }; break; }
      cur = cur.parentElement;
    }
  }
  return result;
})`;

/**
 * Serialises the rendered page for the remediation workspace: readable
 * stylesheets are inlined and scripts removed, so the snapshot renders
 * the same static state offline.
 */
export const SNAPSHOT = String.raw`(() => {
  const unreadable = [];
  const clone = document.documentElement.cloneNode(true);
  const liveLinks = [...document.querySelectorAll('link[rel~="stylesheet"]')];
  const cloneLinks = [...clone.querySelectorAll('link[rel~="stylesheet"]')];
  liveLinks.forEach((link, i) => {
    const target = cloneLinks[i];
    if (!target) return;
    let text = null;
    try { text = [...link.sheet.cssRules].map((r) => r.cssText).join('\n'); } catch {}
    if (text === null) { unreadable.push(link.href); return; }
    const style = document.createElement('style');
    style.setAttribute('data-inlined-from', link.href);
    style.textContent = '\n' + text + '\n';
    target.replaceWith(style);
  });
  clone.querySelectorAll('script, noscript, iframe[src^="javascript"]').forEach((n) => n.remove());
  const doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\n' : '';
  return { html: doctype + clone.outerHTML, unreadable };
})()`;
