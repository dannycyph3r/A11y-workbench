import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDocument, scanUrl, ScanError } from "@/lib/scanner/scan";
import { proposeFix, composeAccepted } from "@/lib/remediation/engine";
import { verifyPatch } from "@/lib/remediation/verify";
import { startEgressProxy } from "@/lib/security/egress-proxy";
import type { EgressPolicy } from "@/lib/security/url-guard";
import type { Finding } from "@/lib/findings/types";
import { SAMPLE_CSS, SAMPLE_JSX } from "@/lib/demo/samples";

const FIXTURE = readFileSync("fixtures/known-bad.html", "utf8");
const MANIFEST = JSON.parse(readFileSync("fixtures/known-bad.defects.json", "utf8")) as { defects: { rule: string; count?: number }[] };
const opts = { profile: "wcag22aa" as const, includeBestPractice: true };
const fixtureDoc = { dialect: "html" as const, text: FIXTURE, fileName: "known-bad.html", origin: "fixture" as const };
const rules = (fs: Finding[]) => fs.map((f) => f.ruleId);

describe("fixture scan in a real browser", () => {
  let findings: Finding[];
  beforeAll(async () => {
    findings = (await scanDocument(fixtureDoc, opts)).audit.findings;
  });

  it("detects every controlled defect listed in the manifest", () => {
    for (const d of MANIFEST.defects) {
      const n = findings.filter((f) => f.ruleId === d.rule).length;
      expect(n, d.rule).toBeGreaterThanOrEqual(d.count ?? 1);
    }
  });

  it("traces each finding to a line in the source", () => {
    const img = findings.find((f) => f.ruleId === "image-alt")!;
    expect(img.node.location!.line).toBe(FIXTURE.split("\n").findIndex((l) => l.includes("<img")) + 1);
    expect(img.node.html).not.toContain("data-awb");
    const located = findings.filter((f) => f.node.location).length;
    expect(located / findings.length).toBeGreaterThan(0.9);
  });

  it("measures contrast from rendered styles, not from the markup text", () => {
    const muted = findings.find((f) => f.ruleId === "color-contrast" && f.node.selector === ".muted")!;
    expect(muted.node.contrast).toMatchObject({ foreground: "#9a9a9a", background: "#ffffff", required: 4.5 });
    expect(muted.node.contrast!.colorSource).toMatchObject({ kind: "rule", selector: ".muted" });
  });

  it("changes its answer when the rendered content changes", async () => {
    const fixed = FIXTURE.replace('<img src="/images/waiting-room.jpg"', '<img alt="Waiting room" src="/images/waiting-room.jpg"').replace(".muted { color: #9a9a9a; }", ".muted { color: #595959; }");
    const again = (await scanDocument({ ...fixtureDoc, text: fixed }, opts)).audit.findings;
    expect(rules(again)).not.toContain("image-alt");
    expect(again.some((f) => f.ruleId === "color-contrast" && f.node.selector === ".muted")).toBe(false);
  });
});

describe("sandbox", () => {
  it("never runs scripts or inline handlers from submitted source", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1>
      <script>document.body.insertAdjacentHTML('beforeend', '<img src="x" id="injected">')</script>
      <img src="data:," onerror="document.title='ran'" alt="">
      <p>ok</p></main></body></html>`;
    const { audit } = await scanDocument({ dialect: "html", text: html, fileName: "s.html", origin: "user-source" }, opts);
    expect(audit.findings.some((f) => f.node.selector.includes("injected"))).toBe(false);
    expect(rules(audit.findings)).not.toContain("image-alt");
  });

  it("treats fragments as fragments (no page-level rules)", async () => {
    const { audit } = await scanDocument({ dialect: "html", text: `<button></button>`, fileName: "f.html", origin: "user-source" }, opts);
    expect(rules(audit.findings)).toEqual(expect.arrayContaining(["button-name"]));
    expect(rules(audit.findings)).not.toContain("document-title");
    expect(audit.scope.notes.join(" ")).toMatch(/fragment/);
  });
});

describe("source dialects", () => {
  it("renders JSX statically and points findings at the JSX lines", async () => {
    const { audit, syntaxErrors } = await scanDocument({ dialect: "jsx", text: SAMPLE_JSX, fileName: "BookingCard.tsx", origin: "user-source" }, opts);
    expect(syntaxErrors).toEqual([]);
    expect(rules(audit.findings)).toEqual(expect.arrayContaining(["image-alt", "button-name", "awb-role-button-div", "aria-valid-attr"]));
    const img = audit.findings.find((f) => f.ruleId === "image-alt")!;
    expect(img.node.location!.line).toBe(SAMPLE_JSX.split("\n").findIndex((l) => l.includes("<img")) + 1);
    expect(audit.limitations.join(" ")).toMatch(/static approximation/);
    // The inline style object was rendered, so contrast is measurable.
    expect(audit.findings.some((f) => f.ruleId === "color-contrast")).toBe(true);
  });

  it("reports syntax errors instead of pretending the source compiled", async () => {
    const r = await scanDocument({ dialect: "jsx", text: "export const A = () => <div", fileName: "A.tsx", origin: "user-source" }, opts);
    expect(r.syntaxErrors[0]).toMatch(/Line 1/);
    expect(r.audit.status).toBe("partial");
    expect(r.audit.warnings.join(" ")).toMatch(/syntax error/);
    await expect(scanDocument({ dialect: "jsx", text: "export const n = 1;", fileName: "n.ts", origin: "user-source" }, opts)).rejects.toBeInstanceOf(ScanError);
  });

  it("checks CSS statically", async () => {
    const { audit } = await scanDocument({ dialect: "css", text: SAMPLE_CSS, fileName: "s.css", origin: "user-source" }, opts);
    expect(rules(audit.findings).sort()).toEqual(["awb-css-contrast", "awb-css-contrast", "awb-outline-suppressed"]);
    expect(audit.scope.pageState).toMatch(/statically/);
  });
});

describe("remediation round trip", () => {
  it("resolves the intended findings on rerun and catches what a fix breaks", async () => {
    const { audit } = await scanDocument(fixtureDoc, opts);
    const inputs: Record<string, Record<string, string>> = {};
    const intended = ["meta-viewport", "html-has-lang", "image-alt", "label", "button-name", "link-name", "color-contrast", "awb-paste-blocked", "awb-role-button-div", "aria-valid-attr", "document-title", "target-size"];
    const fixes = audit.findings
      .filter((f) => intended.includes(f.ruleId))
      .map((f) => {
        inputs[f.id] = { alt: "Clinic waiting room", name: f.ruleId === "link-name" ? "Your account" : "Search", label: "Health card number", title: "Book an appointment" };
        return proposeFix(f, audit.document, inputs[f.id]!, { defaultLang: "en" });
      })
      .filter((x) => x !== null);
    const composed = composeAccepted(audit.document!, fixes);
    expect(composed.conflicts).toEqual([]);
    expect(audit.document!.text).toBe(FIXTURE); // original untouched

    const v = await verifyPatch({ doc: audit.document!, patched: composed.text, edits: composed.edits, profile: "wcag22aa", includeBestPractice: true, findings: audit.findings });
    expect(v.validation.ok).toBe(true);
    const status = (rule: string) => v.results.filter((r) => audit.findings.find((f) => f.id === r.findingId)!.ruleId === rule).map((r) => r.status);
    for (const rule of intended) expect(status(rule).every((s) => s === "resolved"), rule).toBe(true);
    // Untouched findings stay failing: accepting nothing for them must not mark them resolved.
    expect(status("heading-order")).toEqual(["still-failing"]);
    // Correcting aria-labeledby on a paragraph exposes deeper problems, which the rerun reports.
    expect(v.introduced.map((f) => f.ruleId)).toEqual(expect.arrayContaining(["aria-prohibited-attr"]));
    expect(v.afterCount).toBeLessThan(v.beforeCount);
  });

  it("refuses to rescan a patch that breaks the document", async () => {
    const d = { dialect: "jsx" as const, text: "export const A = () => <p>x</p>;", fileName: "A.tsx", origin: "user-source" as const };
    const v = await verifyPatch({ doc: d, patched: "export const A = () => <p>x</p", edits: [], profile: "wcag22aa", includeBestPractice: true, findings: [] });
    expect(v.validation.ok).toBe(false);
  });
});

describe("URL scanning through the egress proxy", () => {
  let site: http.Server;
  let internal: http.Server;
  let sitePort = 0;
  let internalPort = 0;
  let internalHits = 0;

  beforeAll(async () => {
    internal = http.createServer((_req, res) => {
      internalHits++;
      res.end("secret");
    });
    await new Promise<void>((r) => internal.listen(0, "127.0.0.1", r));
    internalPort = (internal.address() as AddressInfo).port;

    site = http.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(FIXTURE);
      if (url === "/redirect") return res.writeHead(302, { location: `http://127.0.0.1:${internalPort}/admin` }).end();
      if (url === "/leaky") return res.writeHead(200, { "content-type": "text/html" }).end(`<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1><img alt="" src="http://127.0.0.1:${internalPort}/pixel.png"></main></body></html>`);
      if (url === "/pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4");
      if (url === "/private") return res.writeHead(401).end();
      res.writeHead(404).end("nope");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    sitePort = (site.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => site.close(r));
    await new Promise((r) => internal.close(r));
  });

  // Only the test site is allowlisted; the "internal" server stands in for private infrastructure.
  const policy = (): EgressPolicy => ({ allowedPorts: new Set([80, 443]), privateAllowlist: new Set([`127.0.0.1:${sitePort}`]) });

  it("scans a page from a real HTTP response and keeps a snapshot for remediation", async () => {
    const audit = await scanUrl(`http://127.0.0.1:${sitePort}/`, { ...opts, policy: policy() });
    expect(audit.input).toMatchObject({ kind: "url", httpStatus: 200 });
    expect(rules(audit.findings)).toEqual(expect.arrayContaining(["image-alt", "color-contrast", "html-has-lang"]));
    expect(audit.document?.origin).toBe("url-snapshot");
    expect(audit.document?.text).toContain("Maple Ridge");
    expect(audit.scope.viewport).toEqual({ width: 1280, height: 800 });
  });

  it("refuses private addresses under the default policy", async () => {
    await expect(scanUrl(`http://127.0.0.1:${sitePort}/`, opts)).rejects.toMatchObject({ code: expect.stringMatching(/blocked/) });
  });

  it("blocks a redirect into private address space", async () => {
    const before = internalHits;
    await expect(scanUrl(`http://127.0.0.1:${sitePort}/redirect`, { ...opts, policy: policy() })).rejects.toMatchObject({ code: "blocked" });
    expect(internalHits).toBe(before);
  });

  it("blocks subresources that point at private addresses and says so", async () => {
    const before = internalHits;
    const audit = await scanUrl(`http://127.0.0.1:${sitePort}/leaky`, { ...opts, policy: policy() });
    expect(internalHits).toBe(before);
    expect(audit.warnings.join(" ")).toMatch(/blocked by the scan policy/);
    expect(audit.status).toBe("partial");
  });

  it("reports HTTP errors, access controls and non-HTML content honestly", async () => {
    await expect(scanUrl(`http://127.0.0.1:${sitePort}/missing`, { ...opts, policy: policy() })).rejects.toMatchObject({ code: "http-error" });
    await expect(scanUrl(`http://127.0.0.1:${sitePort}/private`, { ...opts, policy: policy() })).rejects.toMatchObject({ code: "access-denied" });
    await expect(scanUrl(`http://127.0.0.1:${sitePort}/pdf`, { ...opts, policy: policy() })).rejects.toMatchObject({ code: "unsupported-content" });
  });

  it("refuses CONNECT tunnels to private addresses at the proxy itself", async () => {
    const proxy = await startEgressProxy({ policy: policy(), maxBytes: 1_000_000 });
    const port = Number(new URL(proxy.url).port);
    const reply = await new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(`CONNECT 127.0.0.1:${internalPort} HTTP/1.1\r\nHost: x\r\n\r\n`));
      s.once("data", (d) => {
        resolve(d.toString());
        s.destroy();
      });
    });
    await proxy.close();
    expect(reply).toMatch(/^HTTP\/1\.1 403/);
    expect(proxy.blocked()[0]?.host).toBe("127.0.0.1");
  });
});
