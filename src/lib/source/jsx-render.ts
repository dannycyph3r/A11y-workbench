import "server-only";
import ts from "typescript";
import { lineIndex } from "./tags";

/**
 * Renders the JSX in a component file to static HTML so the browser rule
 * engine can inspect it. Nothing is compiled or executed: expressions are
 * shown as their source text, components become placeholder containers,
 * and every element is stamped with its location in the original file.
 */

export interface JsxRenderResult {
  html: string;
  syntaxErrors: string[];
  stats: { elements: number; components: number; dynamicAttributes: number; spreads: number; expressionChildren: number };
}

const ATTR_RENAME: Record<string, string> = { className: "class", htmlFor: "for" };
const UNITLESS = new Set(["opacity", "zIndex", "fontWeight", "lineHeight", "flex", "flexGrow", "flexShrink", "order", "zoom"]);

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function kebab(s: string) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function syntaxDiagnostics(text: string, fileName: string): string[] {
  const out = ts.transpileModule(text, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (out.diagnostics ?? []).map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `Line ${line + 1}, column ${character + 1}: ${msg}`;
    }
    return msg;
  });
}

export function renderJsx(text: string, fileName = "Component.tsx"): JsxRenderResult {
  const kind = /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const pos = lineIndex(text);
  const stats = { elements: 0, components: 0, dynamicAttributes: 0, spreads: 0, expressionChildren: 0 };

  const isJsx = (n: ts.Node): n is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment =>
    ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);

  const stamp = (start: number, end: number) => {
    const { line, column } = pos(start);
    return ` data-awb-loc="${start}-${end}-${line}-${column}"`;
  };

  function styleFromObject(expr: ts.Expression): string | null {
    if (!ts.isObjectLiteralExpression(expr)) return null;
    const parts: string[] = [];
    for (const p of expr.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (!key) return null;
      const v = p.initializer;
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) parts.push(`${kebab(key)}: ${v.text}`);
      else if (ts.isNumericLiteral(v)) parts.push(`${kebab(key)}: ${v.text}${UNITLESS.has(key) ? "" : "px"}`);
      else return null;
    }
    return parts.join("; ");
  }

  function renderAttributes(attrs: ts.JsxAttributes): string {
    let out = "";
    const dynamic: string[] = [];
    for (const a of attrs.properties) {
      if (ts.isJsxSpreadAttribute(a)) {
        stats.spreads++;
        out += ` data-awb-spread="true"`;
        continue;
      }
      const rawName = a.name.getText(sf);
      const name = ATTR_RENAME[rawName] ?? (/^(aria|data)-/.test(rawName) ? rawName : rawName.toLowerCase());
      const init = a.initializer;
      if (!init) {
        out += ` ${name}`;
        continue;
      }
      if (ts.isStringLiteral(init)) {
        out += ` ${name}="${escapeAttr(init.text)}"`;
        continue;
      }
      if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out += ` ${name}="${escapeAttr(e.text)}"`;
        else if (ts.isNumericLiteral(e)) out += ` ${name}="${e.text}"`;
        else if (e.kind === ts.SyntaxKind.TrueKeyword) out += ` ${name}`;
        else if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined")) continue;
        else if (name === "style") {
          const css = styleFromObject(e);
          if (css !== null) out += ` style="${escapeAttr(css)}"`;
          else dynamic.push(name);
        } else if (/^on[a-z]/.test(name)) {
          // Event handlers are recorded, not run. Scripts are disabled in the sandbox.
          out += ` ${name}=""`;
        } else {
          stats.dynamicAttributes++;
          dynamic.push(name);
          out += ` ${name}="${escapeAttr(`{${e.getText(sf)}}`.slice(0, 120))}"`;
        }
      }
    }
    if (dynamic.length) out += ` data-awb-dynamic="${escapeAttr(dynamic.join(" "))}"`;
    return out;
  }

  function renderChildren(children: ts.NodeArray<ts.JsxChild>): string {
    let out = "";
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const t = child.text;
        if (t.includes("\n")) {
          const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          out += escapeText(lines.join(" "));
        } else out += escapeText(t);
      } else if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        const e = child.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
          out += escapeText(e.text);
          continue;
        }
        const nested = collectRoots(e);
        if (nested.length) out += nested.map(renderNode).join("");
        else {
          stats.expressionChildren++;
          out += `<span data-awb-expr="true">${escapeText(`{${e.getText(sf)}}`.slice(0, 80))}</span>`;
        }
      } else out += renderNode(child);
    }
    return out;
  }

  function renderNode(n: ts.Node): string {
    if (ts.isJsxFragment(n)) return renderChildren(n.children);
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      const tagName = opening.tagName.getText(sf);
      const start = opening.getStart(sf);
      const end = opening.getEnd();
      const isComponent = /^[A-Z]/.test(tagName) || tagName.includes(".");
      const attrs = renderAttributes(opening.attributes);
      stats.elements++;
      if (isComponent) {
        stats.components++;
        const inner = ts.isJsxElement(n) ? renderChildren(n.children) : "";
        return `<div${stamp(start, end)} data-awb-component="${escapeAttr(tagName)}">${inner}</div>`;
      }
      const voidish = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i.test(tagName);
      if (voidish) return `<${tagName}${stamp(start, end)}${attrs}>`;
      const inner = ts.isJsxElement(n) ? renderChildren(n.children) : "";
      return `<${tagName}${stamp(start, end)}${attrs}>${inner}</${tagName}>`;
    }
    return "";
  }

  /** Outermost JSX nodes under `root`, not descending into JSX already found. */
  function collectRoots(root: ts.Node): ts.Node[] {
    const found: ts.Node[] = [];
    const visit = (n: ts.Node) => {
      if (isJsx(n)) {
        found.push(n);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
    return found;
  }

  const roots = collectRoots(sf);
  const html = roots.map(renderNode).join("\n");
  return { html, syntaxErrors: syntaxDiagnostics(text, fileName), stats };
}
