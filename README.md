# A11y Workbench

Audit a web page, component source or a Figma design against WCAG 2.2 AA, WCAG 2.1 AA, WCAG 2.0 AA or an AODA profile. Review each finding with its evidence, accept or reject proposed code fixes as real diffs, then rerun the checks to see which fixes actually resolved what.

> Passing automated checks is not conformance. Every report states the standard, scope, engine version and limitations, and includes a manual-review checklist for every criterion in the profile.

## Run it locally

Requires Node.js 20.9 or later.

```bash
npm install
npx playwright install chromium   # the browser the scanner drives
npm run dev                       # http://localhost:3000
```

Production build:

```bash
npm run build
npm start                         # http://localhost:3000
```

No environment variables are required. Copy `.env.example` to `.env.local` to configure optional features.

| Variable | Purpose |
|---|---|
| `A11Y_CHROMIUM_PATH` | Use a specific Chromium binary instead of the one Playwright installs. |
| `FIGMA_ACCESS_TOKEN` | Enables Figma import by link. Read on the server only; never sent to the browser. |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL` | Optional plain-language explanations for findings that need a person. Off by default. |
| `SCAN_DEV_ALLOWLIST` | Development only. Comma-separated `host:port` pairs the URL scanner may reach even though they are private. Ignored when `NODE_ENV=production`. |
| `SCAN_UPSTREAM_PROXY` | Chain scanner traffic through a corporate HTTP proxy. See the security notes for the trade-off. |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint with the Next.js and TypeScript rules |
| `npm test` | Unit tests (no browser) |
| `npm run test:integration` | Real-browser tests: fixture scan, sandbox, remediation round trip, SSRF defences |
| `npm run test:e2e` | Playwright against the production build, including an axe scan of the app itself |
| `npm run test:all` | All of the above |
| `npm run demo:generate` | Re-records the bundled demo audit from a real scan of the sample page |

## What it does

**Inputs**

- **Website URL.** One public page per audit, rendered in an isolated Chromium context at a chosen viewport. The scanner waits for network activity to settle, runs the rules, tabs through the page and keeps an offline snapshot for remediation.
- **Source code.** HTML, JSX, TSX or CSS, pasted or uploaded. HTML is rendered with every page script and network request blocked. JSX is rendered statically from the TypeScript syntax tree; it is never compiled or executed, and the audit says so. CSS is checked statically.
- **Figma.** A file link (with `FIGMA_ACCESS_TOKEN`) or a JSON export of the REST API response. JSON is analysed in the browser and never uploaded.
- **Test page.** A bundled, deliberately flawed clinic booking page (`fixtures/known-bad.html`), scanned live with the real engine.
- **Demo audit.** A recorded scan of the same page, labelled as demo data wherever it appears.

**Checks**

- axe-core runs every rule tagged for the selected profile, including the WCAG 2.2 target-size rule that ships disabled.
- Custom checks, each reported as a heuristic and kept separate from engine violations:
  - a real keyboard walk with the Tab key, comparing each element's focused and unfocused styles (2.4.7), detecting fully obscured focus under fixed or sticky content (2.4.11) and focus that does not move (2.1.2);
  - stylesheets that remove the focus outline with no replacement;
  - clickable elements that are not focusable, and `role="button"` on a `div` or `span`;
  - draggable elements needing a single-pointer alternative (2.5.7);
  - paste blocking and `autocomplete="off"` on password fields (3.3.8).
- Contrast is computed with WCAG relative luminance, with alpha compositing. If the background cannot be resolved (image, gradient, overlap, translucent stack), the result is inconclusive and no ratio is shown.

Every finding records its rule, category, kind (violation, heuristic, needs review, inconclusive), impact, the WCAG criteria it maps to, the affected element and its source line where traceable, evidence, a recommended fix, fix confidence, verification status and any manual-review notes.

**Remediation**

Fixes are deterministic text edits on the audited document, never on a live site. Each carries one of three confidence states:

- *High-confidence suggestion*: deterministic and well supported (for example removing `user-scalable=no`).
- *Review recommended*: context-dependent or may change the design (contrast colours, native element swaps, ARIA corrections).
- *Manual assessment required*: the workbench cannot know the right content. Alt text, accessible names, labels and page titles are never invented; the workspace asks the person to write them and only then produces the edit.

Accepted fixes are composed into one patch. Overlapping fixes are reported as conflicts, not silently dropped. **Verify** rescans the original and the patched document under identical sandbox conditions and reports, per finding, *resolved on rerun*, *still failing* or *needs manual check*, plus any findings the patch introduced. Accepting a fix never marks it resolved on its own.

Exports: a unified `.patch` (applies with `git apply`), the patched file, and reports as JSON, CSV or print-to-PDF.

## Architecture

```
src/
  app/                      Next.js App Router pages and API routes
    api/scan/{url,source,fixture}, api/verify, api/figma/import, api/explain, api/status
  components/               Shell, store (session state), diff view, shared UI
  lib/
    standards/              WCAG 2.0 to 2.2 criteria catalogue and audit profiles
    contrast/               Colour parsing, compositing, WCAG ratio, suggestions
    security/               URL validation, IP classification, egress proxy, rate limits
    scanner/                Browser lifecycle, in-page scripts, page audit, scan orchestration
    findings/               Types, rule guidance, normalisation of engine and custom results
    source/                 Offset-preserving tag scanner, JSX static renderer, CSS checks
    remediation/            Text edits, fixers, patch composition, diff, verification, state
    figma/                  URL parsing, API client, design analysis
    report/                 Report model, CSV
    ai/                     Optional explanation provider
fixtures/                   Deliberately flawed page and its defect manifest
tests/unit, tests/integration, tests/e2e
docs/                       Architecture notes and the planned GitHub integration
```

More detail in [docs/architecture.md](docs/architecture.md).

## Security boundaries

- **URL validation.** Only `http` and `https`; no embedded credentials; ports 80, 443, 8080 and 8443; local and internal names (`localhost`, `.local`, `.internal`, `.home.arpa` and others) refused. IP literals in any form (decimal, octal, hex, IPv4-mapped IPv6, NAT64, 6to4) are normalised and classified against private, loopback, link-local, carrier-grade NAT, documentation, multicast and reserved ranges.
- **Egress proxy.** Each URL scan starts its own forward proxy on `127.0.0.1` and points the browser context at it with Chromium's implicit loopback bypass removed. Every connection, including redirects, subresources and websockets, is resolved by the proxy, refused if any resolved address is non-public, and then connected to the exact address that was checked. This closes the DNS rebinding window. The proxy also enforces a 30 MB transfer budget.
- **Limits.** 30 second navigation timeout, at most five redirects, two concurrent browser jobs with a short queue, and per-client rate limits (6 URL scans and 20 source scans a minute). Limits are in memory; see deployment notes.
- **Sandbox for submitted code.** Source and snapshots load into a context whose only allowed request is the document itself, served with a Content Security Policy that forbids every script, inline handler, frame, plugin and connection. The engine's own scripts are injected over the DevTools protocol, which CSP does not govern.
- **No execution of fixes.** Patches are text. Nothing is applied to a remote site or repository.
- **Untrusted content.** Scanned markup is rendered as text in the UI, never as HTML. If AI explanations are enabled, finding data is wrapped as untrusted input with instructions to ignore any instructions inside it, and the response is shown as advice only.
- **Errors.** API errors return a code and a plain message; stack traces stay in the server log.
- **Privacy.** The server holds content only for the length of a request. Audits live in the browser's session storage and disappear when the tab closes. Settings (no content) live in local storage.

Known residual risks: with `SCAN_UPSTREAM_PROXY` set, the upstream proxy resolves names again after the workbench has checked them, which reopens a narrow rebinding window. Rate limiting trusts `x-forwarded-for`, so deploy behind a proxy that sets it.

## Limitations

- One page and one state per URL audit: no clicking, form submission, scrolling or authentication. Content inside iframes is not tested.
- Automated rules cover a minority of WCAG success criteria; the criteria map on the Overview shows exactly which ones were reached for each audit.
- Keyboard checks are heuristics from a scripted Tab walk. They cannot prove every task is keyboard operable.
- JSX is a static approximation: components render as placeholders and dynamic values appear as their expression text.
- URL remediation edits a snapshot of the rendered DOM, not the site's source. Verification of snapshots runs offline, so findings that depend on scripts, images or live data are marked *needs manual check*.
- Figma checks measure solid layers only. Gradients, images, blend modes and partial overlaps are reported as inconclusive. Keyboard, semantics and focus can only be tested in a built implementation.
- The AODA profile is a technical reading of section 14 of O. Reg. 191/11 (WCAG 2.0 AA, excluding 1.2.4 and 1.2.5). It is not legal advice.

## Deployment considerations

- The scanner needs a Node.js runtime with Chromium, so deploy the app as a long-running Node server or container (for example `node:22` plus `npx playwright install --with-deps chromium`). Serverless functions with short time limits are a poor fit for URL scans.
- Rate limits and the concurrency gate are per process. For multiple instances, move both to shared storage such as Redis, or run scans in a dedicated worker service.
- Put the scanner in a network segment with no route to internal services as defence in depth, even though the egress proxy already refuses private destinations.
- Set `FIGMA_ACCESS_TOKEN` and AI keys as server secrets. They are never exposed to the client bundle.
