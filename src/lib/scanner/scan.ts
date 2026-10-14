import "server-only";
import type { BrowserContext, Page } from "playwright";
import { randomUUID } from "node:crypto";
import { PROFILES, type ProfileId } from "@/lib/standards/profiles";
import type { Audit, AuditInput, DocumentDialect, RemediationDocument } from "@/lib/findings/types";
import { normalizeCustom, sortFindings } from "@/lib/findings/normalize";
import { instrumentHtml, isFullDocument } from "@/lib/source/tags";
import { checkCss } from "@/lib/source/css";
import { renderJsx } from "@/lib/source/jsx-render";
import { checkUrlHop, defaultPolicy, effectivePort, GuardError, validateUrlSyntax, type EgressPolicy } from "@/lib/security/url-guard";
import { BLOCK_HEADER, startEgressProxy } from "@/lib/security/egress-proxy";
import { withBrowserSlot } from "@/lib/security/limits";
import { WORKBENCH_VERSION } from "@/lib/version";
import { getBrowser, scheduleIdleClose, axeVersion } from "./browser";
import { auditPage } from "./page-audit";
import { SNAPSHOT } from "./page-scripts";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;
export type ViewportId = keyof typeof VIEWPORTS;

export class ScanError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

const SANDBOX_URL = "https://sandbox.awb.invalid/document.html";
const MAX_SNAPSHOT_CHARS = 2_000_000;
const MAX_TRANSFER_BYTES = 30 * 1024 * 1024;

const BASE_LIMITATIONS = [
  "Automated rules detect a subset of WCAG failures. A clean result does not mean the page conforms.",
  "Only the tested page state was inspected: no menus were opened, forms submitted or content expanded.",
  "Keyboard checks are heuristics from a scripted Tab walk; they cannot confirm that every task is operable.",
  "Screen reader output, cognitive load and the meaning of text alternatives require a person.",
];

function wrapFragment(fragment: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Fragment under test</title></head><body><main>${fragment}</main></body></html>`;
}

function assemble(partial: {
  input: AuditInput;
  profile: ProfileId;
  includeBestPractice: boolean;
  browserVersion?: string;
  pageState: string;
  viewport?: { width: number; height: number };
  result: Awaited<ReturnType<typeof auditPage>> | null;
  extraFindings?: Audit["findings"];
  notes: string[];
  warnings: string[];
  limitations: string[];
  document?: RemediationDocument;
  status?: Audit["status"];
}): Audit {
  const r = partial.result;
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    isDemo: false,
    status: partial.status ?? (partial.warnings.length ? "partial" : "complete"),
    input: partial.input,
    profile: partial.profile,
    includeBestPractice: partial.includeBestPractice,
    engine: { name: "axe-core", version: r?.engineVersion ?? axeVersion(), browser: partial.browserVersion, workbench: WORKBENCH_VERSION },
    scope: { pageState: partial.pageState, viewport: partial.viewport, rulesRun: r?.rulesRun ?? 0, notes: partial.notes },
    criteriaExercised: r?.criteriaExercised ?? [],
    counts: r?.counts ?? { passes: 0, violations: 0, incomplete: 0, inapplicable: 0 },
    findings: sortFindings([...(r?.findings ?? []), ...(partial.extraFindings ?? [])]),
    warnings: [...new Set(partial.warnings)],
    limitations: partial.limitations,
    document: partial.document,
  };
}

/**
 * Content Security Policy for sandboxed documents. It forbids every page
 * script, inline handler, plugin, frame and connection, so submitted code
 * never runs. The engine's own scripts are injected over the DevTools
 * protocol, which CSP does not govern.
 */
const SANDBOX_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Opens a context in which no network request leaves the browser and page scripts never run. */
async function sandboxPage(html: string, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport, serviceWorkers: "block", acceptDownloads: false });
  await context.route("**/*", (route) =>
    route.request().url() === SANDBOX_URL && route.request().isNavigationRequest() && !route.request().redirectedFrom()
      ? route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": SANDBOX_CSP }, body: html })
      : route.abort("blockedbyclient"),
  );
  const page = await context.newPage();
  await page.goto(SANDBOX_URL, { waitUntil: "load", timeout: 15_000 });
  return { context, page };
}

export interface DocumentScanOptions {
  profile: ProfileId;
  includeBestPractice: boolean;
  viewport?: ViewportId;
  signal?: AbortSignal;
}

export interface DocumentScanResult {
  audit: Audit;
  syntaxErrors: string[];
}

/**
 * Scans user source (or a snapshot) in the sandbox. HTML is rendered
 * as written, JSX as a static approximation, CSS by static rules only.
 */
export async function scanDocument(
  doc: { dialect: DocumentDialect; text: string; fileName: string; origin: RemediationDocument["origin"] },
  opts: DocumentScanOptions,
): Promise<DocumentScanResult> {
  const viewport = VIEWPORTS[opts.viewport ?? "desktop"];
  const remediationDoc: RemediationDocument = { dialect: doc.dialect, fileName: doc.fileName, origin: doc.origin, text: doc.text };
  const input: AuditInput =
    doc.origin === "fixture" ? { kind: "fixture", fileName: doc.fileName } : { kind: "source", fileName: doc.fileName, dialect: doc.dialect };
  const limitations = [...BASE_LIMITATIONS, "Submitted source was rendered with page scripts and all network requests blocked."];

  if (doc.dialect === "css") {
    const raw = checkCss(doc.text);
    return {
      syntaxErrors: [],
      audit: assemble({
        input,
        profile: opts.profile,
        includeBestPractice: opts.includeBestPractice,
        pageState: "Stylesheet read statically. Nothing was rendered.",
        result: null,
        extraFindings: raw.map((r) => normalizeCustom(r, opts.profile)),
        notes: ["CSS is checked for focus-outline removal and declared colour pairs. Element-level rules need HTML."],
        warnings: [],
        limitations: [...limitations, "Declared colours are measured as written; the real cascade may differ."],
        document: remediationDoc,
      }),
    };
  }

  let html: string;
  let isFragment: boolean;
  const notes: string[] = [];
  let syntaxErrors: string[] = [];
  if (doc.dialect === "jsx") {
    const rendered = renderJsx(doc.text, doc.fileName);
    syntaxErrors = rendered.syntaxErrors;
    if (!rendered.html.trim()) {
      throw new ScanError("no-jsx", syntaxErrors.length ? `The file has syntax errors: ${syntaxErrors[0]}` : "No JSX elements were found in this file.");
    }
    html = wrapFragment(rendered.html);
    isFragment = true;
    const s = rendered.stats;
    notes.push(
      `JSX was rendered statically from ${s.elements} elements; it was not compiled or executed.`,
      ...(s.components ? [`${s.components} custom component${s.components === 1 ? " was" : "s were"} rendered as placeholders, so their internals were not checked.`] : []),
      ...(s.dynamicAttributes ? [`${s.dynamicAttributes} dynamic attribute${s.dynamicAttributes === 1 ? "" : "s"} were shown as their expression text, so values cannot be judged.`] : []),
      ...(s.spreads ? [`${s.spreads} spread attribute${s.spreads === 1 ? "" : "s"} could add props this scan cannot see.`] : []),
    );
    limitations.push("JSX findings describe a static approximation. Confirm them in the running component.");
  } else {
    isFragment = !isFullDocument(doc.text);
    const instrumented = instrumentHtml(doc.text);
    html = isFragment ? wrapFragment(instrumented) : instrumented;
    if (isFragment) notes.push("The HTML is a fragment, so page-level rules (title, language, landmarks) were not run.");
  }

  const result = await withBrowserSlot(async () => {
    const { context, page } = await sandboxPage(html, viewport);
    try {
      const browserVersion = context.browser()?.version();
      const r = await auditPage(page, {
        profile: opts.profile,
        includeBestPractice: opts.includeBestPractice,
        isFragment,
        keyboardWalk: true,
        signal: opts.signal,
      });
      return { r, browserVersion };
    } finally {
      await context.close().catch(() => undefined);
      scheduleIdleClose();
    }
  });

  const pageState =
    doc.origin === "url-snapshot"
      ? "Rendered snapshot of the page, re-rendered offline with page scripts blocked."
      : "Initial render of the submitted markup with page scripts blocked; no interaction beyond a Tab walk.";
  return {
    syntaxErrors,
    audit: assemble({
      input,
      profile: opts.profile,
      includeBestPractice: opts.includeBestPractice,
      browserVersion: result.browserVersion,
      pageState,
      viewport,
      result: result.r,
      notes: [...notes, `The Tab walk reached ${result.r.tabStops} focusable element${result.r.tabStops === 1 ? "" : "s"}.`],
      warnings: [...result.r.warnings, ...(syntaxErrors.length ? [`The source has ${syntaxErrors.length} syntax error(s); results may be incomplete.`] : [])],
      limitations,
      document: remediationDoc,
    }),
  };
}

export interface UrlScanOptions extends DocumentScanOptions {
  policy?: EgressPolicy;
}

/** Scans one live page through the guarded egress proxy. */
export async function scanUrl(rawUrl: string, opts: UrlScanOptions): Promise<Audit> {
  const policy = opts.policy ?? defaultPolicy();
  const url = validateUrlSyntax(rawUrl, policy);
  await checkUrlHop(url.href, policy); // fail fast with a clear message before launching anything
  const viewport = VIEWPORTS[opts.viewport ?? "desktop"];

  return withBrowserSlot(async () => {
    const proxy = await startEgressProxy({ policy, maxBytes: MAX_TRANSFER_BYTES, upstream: process.env.SCAN_UPSTREAM_PROXY || undefined });
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport,
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
    });
    const abort = () => void context.close().catch(() => undefined);
    opts.signal?.addEventListener("abort", abort, { once: true });
    const warnings: string[] = [];
    try {
      let redirects = 0;
      await context.route("**/*", async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort("blockedbyclient");
        if (req.isNavigationRequest() && req.redirectedFrom()) {
          redirects++;
          if (redirects > 5) return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      const page = await context.newPage();
      let response;
      try {
        response = await page.goto(url.href, { waitUntil: "load", timeout: 30_000 });
      } catch (err) {
        const blockedHost = proxy.blocked()[0];
        if (blockedHost) throw new ScanError("blocked", `The page redirected or connected to a blocked destination: ${blockedHost.reason}`);
        if (opts.signal?.aborted) throw new ScanError("cancelled", "The scan was cancelled.", 499);
        const msg = err instanceof Error ? err.message : "";
        if (/download/i.test(msg)) throw new ScanError("unsupported-content", "The address returned a file download, not a web page. Only HTML pages can be scanned.");
        if (/timeout/i.test(msg)) throw new ScanError("timeout", "The page did not finish loading within 30 seconds.");
        throw new ScanError("unreachable", "The page could not be loaded. Check the address and that the site is publicly reachable.");
      }
      if (!response) throw new ScanError("no-response", "The page returned no response.");
      if (response.headers()[BLOCK_HEADER]) {
        throw new ScanError("blocked", `The page redirected or connected to a blocked destination: ${proxy.blocked().at(-1)?.reason ?? "refused by the scan policy"}`);
      }
      const status = response.status();
      if (status === 401 || status === 403) {
        throw new ScanError("access-denied", `The page returned ${status}. It needs a sign-in or blocks automated access, and the scanner does not bypass access controls.`);
      }
      if (status >= 400) throw new ScanError("http-error", `The page returned HTTP ${status}, so there is no content to assess.`);
      const contentType = response.headers()["content-type"] ?? "";
      if (contentType && !/html|xml/i.test(contentType)) {
        throw new ScanError("unsupported-content", `The address returned ${contentType.split(";")[0]}, not a web page. Only HTML pages can be scanned.`);
      }
      if (redirects > 5) throw new ScanError("too-many-redirects", "The page redirected more than five times.");
      // Revalidate where we ended up (the proxy already enforced every hop).
      validateUrlSyntax(page.url(), policy);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => warnings.push("The page kept loading resources; it was scanned after a 5 second wait."));
      await page.waitForTimeout(400);

      const title = await page.title().catch(() => "");
      if (/just a moment|attention required|captcha|verify you are human/i.test(title)) {
        warnings.push("The page appears to be a bot check. Findings describe that page, not the intended content, and the scanner will not try to bypass it.");
      }

      const r = await auditPage(page, { profile: opts.profile, includeBestPractice: opts.includeBestPractice, isFragment: false, keyboardWalk: true, signal: opts.signal });
      const snap = (await page.evaluate(SNAPSHOT)) as { html: string; unreadable: string[] };
      const blocked = proxy.blocked();
      if (blocked.length) warnings.push(`${blocked.length} request${blocked.length === 1 ? " was" : "s were"} blocked by the scan policy (private or disallowed destinations).`);
      if (snap.unreadable.length) warnings.push(`${snap.unreadable.length} cross-origin stylesheet${snap.unreadable.length === 1 ? "" : "s"} could not be read, so the snapshot may render without some styles.`);
      if (proxy.bytes() > MAX_TRANSFER_BYTES) warnings.push("The page exceeded the 30 MB transfer limit; later resources were cut off.");

      const document: RemediationDocument | undefined =
        snap.html.length <= MAX_SNAPSHOT_CHARS
          ? { dialect: "html", fileName: `${new URL(page.url()).hostname}-snapshot.html`, origin: "url-snapshot", text: snap.html }
          : undefined;
      if (!document) warnings.push("The rendered page is larger than 2 MB, so no snapshot was kept for remediation.");

      return assemble({
        input: { kind: "url", requestedUrl: url.href, finalUrl: page.url(), httpStatus: status },
        profile: opts.profile,
        includeBestPractice: opts.includeBestPractice,
        browserVersion: browser.version(),
        pageState: "Initial load after network activity settled. No clicks, form input or scrolling; a scripted Tab walk only.",
        viewport,
        result: r,
        notes: [
          `The Tab walk reached ${r.tabStops} focusable element${r.tabStops === 1 ? "" : "s"}.`,
          "Content inside iframes was not tested.",
          `Port ${effectivePort(url)} over ${url.protocol.replace(":", "").toUpperCase()}.`,
        ],
        warnings: [...r.warnings, ...warnings],
        limitations: [
          ...BASE_LIMITATIONS,
          "Only this page was scanned, not the rest of the site.",
          "Fixes apply to a snapshot of the rendered page, not to the site's source files. Port accepted changes to your codebase.",
        ],
        document,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw new ScanError("cancelled", "The scan was cancelled.", 499);
      if (err instanceof GuardError) throw new ScanError(err.code, err.message, 400);
      throw err;
    } finally {
      opts.signal?.removeEventListener("abort", abort);
      await context.close().catch(() => undefined);
      await proxy.close();
      scheduleIdleClose();
    }
  });
}

export { PROFILES };
