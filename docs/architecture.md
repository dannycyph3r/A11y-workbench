# Architecture notes

## Request flow for a URL audit

1. `POST /api/scan/url` validates the body with Zod, applies the rate limit, then calls `scanUrl`.
2. `validateUrlSyntax` normalises the URL and refuses unsafe schemes, credentials, ports and local names. `checkUrlHop` resolves the host and refuses it if any address is non-public.
3. Inside the concurrency gate, `startEgressProxy` opens a per-scan proxy on `127.0.0.1`. A new browser context is created with that proxy and the bypass list `<-loopback>`, so even loopback traffic goes through the proxy.
4. The page loads. Navigation, redirects and subresources are each resolved and checked by the proxy, then connected to the pinned address. Proxy refusals carry an `x-awb-blocked` header so the scanner can tell them from a site's own 403.
5. `auditPage` injects axe-core by evaluation, runs the profile's rules, locates where failing text colours are declared, runs the structural checks in `page-scripts.ts`, then tabs through the page.
6. `SNAPSHOT` serialises the rendered DOM with readable stylesheets inlined and scripts removed.
7. Back in the route, the snapshot is rescanned in the sandbox. `attachLocations` pairs live findings with snapshot findings by rule and markup so fixes can target exact offsets.

## Source audits and the sandbox

`scanDocument` renders HTML as written (fragments are wrapped and page-level rules disabled), JSX through `renderJsx`, and CSS statically through `checkCss`. Before rendering, `instrumentHtml` stamps every start tag with `data-awb-loc="start-end-line-column"`. The stamp goes first in the tag so it survives the engine's truncated snippets; normalisation strips it from everything shown to people.

The sandbox context fulfils exactly one request, the document, with a CSP that blocks all scripts. Disabling JavaScript entirely was tried first and rejected: axe-core relies on timers, which do not run when script execution is disabled.

## Findings model

Engine results and custom checks both normalise to `Finding` (`src/lib/findings/types.ts`). Four kinds are kept apart: `violation`, `heuristic`, `needs-review`, `inconclusive`. Fingerprints combine the rule with the source offset when known, otherwise the selector, so reruns can be matched.

## Remediation

`fixers.ts` maps rule ids to pure functions returning text edits. They operate on the original text through `parseStartTagAt`, which keeps exact attribute ranges and understands JSX braces and spreads. `composeAccepted` applies accepted fixes in acceptance order, dedupes identical edits (two findings fixed by one CSS rule) and reports overlaps as conflicts.

`verifyPatch` validates the patched text (tag counts for HTML, syntax diagnostics for JSX, brace balance for CSS), rescans before and after, maps each original offset through the edits with `mapOffset`, and classifies every finding. Findings present after the patch that do not map back to a finding before it are reported as introduced.

## Design checks

`analyzeFigma` walks the node tree in paint order. For each text layer it looks back through earlier layers for the topmost one whose bounds fully contain the text. Solid fills are composited with layer opacity; gradients, images, blend modes and partial overlaps end the search as inconclusive.

## State

The browser keeps audits and remediation decisions in session storage through `StoreProvider`. The reducer in `remediation/state.ts` marks verification stale whenever an accepted fix changes, and reports only include verification that is current.
