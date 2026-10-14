"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CodeXml, FlaskConical, Globe, PenTool, Square, Upload } from "lucide-react";
import { useStore } from "@/components/store";
import { useAnnounce } from "@/components/shell";
import { Tabs } from "@/components/tabs";
import { Notice, PageHeader, Spinner } from "@/components/ui";
import { postJson, useServerStatus } from "@/components/client-utils";
import { PROFILES, PROFILE_IDS, type ProfileId } from "@/lib/standards/profiles";
import type { Audit } from "@/lib/findings/types";
import { analyzeFigma, FigmaFormatError } from "@/lib/figma/analyze";
import { SAMPLE_CSS, SAMPLE_HTML, SAMPLE_JSX } from "@/lib/demo/samples";

type Method = "url" | "source" | "figma" | "fixture";

const TABS = [
  { id: "url", label: "Website URL", icon: Globe },
  { id: "source", label: "Source code", icon: CodeXml },
  { id: "figma", label: "Figma design", icon: PenTool },
  { id: "fixture", label: "Test page", icon: FlaskConical },
];

const STEPS: Record<Method, string[]> = {
  url: ["Check the address and every network hop against the scan policy", "Load the page in an isolated browser", "Run the rule engine and custom checks", "Tab through the page", "Re-render a snapshot offline for remediation"],
  source: ["Render the markup with scripts and network blocked", "Run the rule engine and custom checks", "Tab through the rendered markup"],
  fixture: ["Render the bundled page with scripts and network blocked", "Run the rule engine and custom checks", "Tab through the page"],
  figma: ["Read the design layers", "Measure text contrast and target sizes"],
};

function Fieldset({ legend, children, hint }: { legend: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="field-label">{legend}</legend>
      {hint ? <p className="field-hint -mt-0.5 mb-2">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

export function NewAudit() {
  const { ready } = useStore();
  // Wait for saved settings so the form starts from the user's defaults.
  if (!ready) return <p role="status">Loading your session</p>;
  return <NewAuditForm />;
}

function NewAuditForm() {
  const params = useSearchParams();
  const router = useRouter();
  const announce = useAnnounce();
  const { settings, addAudit } = useStore();
  const { status } = useServerStatus();
  const initial = (params.get("method") as Method | null) ?? "url";
  const [method, setMethod] = useState<Method>(TABS.some((t) => t.id === initial) ? initial : "url");
  const [profile, setProfile] = useState<ProfileId>(settings.profile);
  const [includeBP, setIncludeBP] = useState(settings.includeBestPractice);
  const [viewport, setViewport] = useState(settings.viewport);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldErrorState] = useState<string | null>(null);
  const [errorTarget, setErrorTarget] = useState<string | null>(null);
  const setFieldError = (message: string | null, target: string | null = null) => {
    setFieldErrorState(message);
    setErrorTarget(target);
  };
  const abortRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // URL tab
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  // Source tab
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("component.html");
  const [dialect, setDialect] = useState<"auto" | "html" | "jsx" | "css">("auto");
  // Figma tab
  const [figmaUrl, setFigmaUrl] = useState("");
  const [figmaJson, setFigmaJson] = useState<{ name: string; text: string } | null>(null);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const options = { profile, includeBestPractice: includeBP, viewport };

  async function run(fn: (signal: AbortSignal) => Promise<{ ok: true; audit: Audit } | { ok: false; message: string; code?: string }>) {
    setError(null);
    setFieldError(null);
    setElapsed(0);
    setRunning(true);
    announce("Audit started.");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const result = await fn(ctrl.signal);
    setRunning(false);
    abortRef.current = null;
    if (!result.ok) {
      if (result.code === "cancelled") {
        announce("Audit cancelled.");
        return;
      }
      setError(result.message);
      return;
    }
    addAudit(result.audit);
    announce(`Audit complete with ${result.audit.findings.length} findings.`);
    router.push("/findings");
  }

  function submitUrl(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return setFieldError("Enter the address of the page to scan.", "url");
    if (!/^https?:\/\//i.test(url.trim())) return setFieldError("Start the address with https:// or http://.", "url");
    if (!authorized) return setFieldError("Confirm you own the site or are authorised to assess it.", "authorized");
    void run(async (signal) => {
      const r = await postJson<{ audit: Audit }>("/api/scan/url", { url: url.trim(), authorized: true, ...options }, signal);
      return r.ok ? { ok: true, audit: r.data.audit } : r;
    });
  }

  function submitSource(e: FormEvent) {
    e.preventDefault();
    if (!source.trim()) return setFieldError("Paste some source or upload a file first.", "source");
    void run(async (signal) => {
      const r = await postJson<{ audit: Audit; syntaxErrors: string[] }>(
        "/api/scan/source",
        { text: source, fileName: fileName.trim() || "source.html", dialect: dialect === "auto" ? undefined : dialect, ...options },
        signal,
      );
      return r.ok ? { ok: true, audit: r.data.audit } : r;
    });
  }

  function submitFixture() {
    void run(async (signal) => {
      const r = await postJson<{ audit: Audit }>("/api/scan/fixture", { fixture: "known-bad", ...options }, signal);
      return r.ok ? { ok: true, audit: r.data.audit } : r;
    });
  }

  function submitFigmaUrl(e: FormEvent) {
    e.preventDefault();
    if (!figmaUrl.trim()) return setFieldError("Paste a Figma file link.");
    void run(async (signal) => {
      const r = await postJson<{ audit: Audit }>("/api/figma/import", { url: figmaUrl.trim(), profile }, signal);
      return r.ok ? { ok: true, audit: r.data.audit } : r;
    });
  }

  function submitFigmaJson() {
    if (!figmaJson) return setFieldError("Choose a JSON export first.");
    void run(async () => {
      try {
        const audit = analyzeFigma(JSON.parse(figmaJson.text), profile, { fileName: figmaJson.name, via: "json" });
        return { ok: true, audit };
      } catch (err) {
        if (err instanceof SyntaxError) return { ok: false, message: "That file is not valid JSON." };
        if (err instanceof FigmaFormatError) return { ok: false, message: err.message };
        return { ok: false, message: "The design could not be read." };
      }
    });
  }

  async function readFile(file: File, onText: (text: string) => void) {
    if (file.size > 25 * 1024 * 1024) return setFieldError("That file is larger than 25 MB.");
    onText(await file.text());
  }

  const fieldErrId = "field-error";

  return (
    <>
      <PageHeader
        title="New audit"
        description="Choose what to check. Each audit tests one page, file or design against the standard you pick, and every result says what was and was not tested."
      />

      <div className="grid gap-8 xl:grid-cols-[1fr_320px]">
        <div className="panel p-5 sm:p-6">
          <Tabs tabs={TABS} value={method} onChange={(m) => { setMethod(m as Method); setFieldError(null); setError(null); }} label="Audit input">
            {method === "url" ? (
              <form onSubmit={submitUrl} noValidate className="flex flex-col gap-5">
                <div>
                  <label htmlFor="scan-url" className="field-label">Page address</label>
                  <input
                    id="scan-url"
                    className="input"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://example.org/contact"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={errorTarget === "url" ? true : undefined}
                    aria-describedby={`scan-url-hint${errorTarget === "url" ? ` ${fieldErrId}` : ""}`}
                  />
                  <p id="scan-url-hint" className="field-hint">One public page per audit. Private, local and internal addresses are refused, and the scanner never signs in.</p>
                </div>
                <div className="flex items-start gap-3">
                  <input id="authorized" type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} aria-invalid={errorTarget === "authorized" ? true : undefined} aria-describedby={errorTarget === "authorized" ? fieldErrId : undefined} />
                  <label htmlFor="authorized" className="text-sm">I own this site or am authorised to assess it.</label>
                </div>
                {fieldError ? <FieldError id={fieldErrId}>{fieldError}</FieldError> : null}
                {status && !status.scanner.available ? (
                  <Notice tone="warning" title="The scanning browser is not available">Run <code>npx playwright install chromium</code> on the server, or set A11Y_CHROMIUM_PATH. Source, Figma JSON and demo audits still work.</Notice>
                ) : null}
                <div>
                  <button type="submit" className="btn btn-primary" disabled={running}>Scan page</button>
                </div>
              </form>
            ) : null}

            {method === "source" ? (
              <form onSubmit={submitSource} noValidate className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-[220px] flex-1">
                    <label htmlFor="src-name" className="field-label">File name</label>
                    <input id="src-name" className="input" value={fileName} onChange={(e) => setFileName(e.target.value)} aria-describedby="src-name-hint" />
                    <p id="src-name-hint" className="field-hint">The extension (.html, .jsx, .tsx, .css) decides how the source is read.</p>
                  </div>
                  <div>
                    <label htmlFor="src-dialect" className="field-label">Language</label>
                    <select id="src-dialect" className="input" value={dialect} onChange={(e) => setDialect(e.target.value as typeof dialect)}>
                      <option value="auto">Detect from file</option>
                      <option value="html">HTML</option>
                      <option value="jsx">JSX or TSX</option>
                      <option value="css">CSS</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <label htmlFor="src-text" className="field-label mb-0">Source</label>
                    <span className="text-xs text-ink-3" aria-live="polite">{source ? `${source.split("\n").length} lines` : ""}</span>
                  </div>
                  <textarea
                    id="src-text"
                    className="input min-h-[300px]"
                    spellCheck={false}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    aria-describedby={`src-text-hint${errorTarget === "source" ? ` ${fieldErrId}` : ""}`}
                    aria-invalid={errorTarget === "source" ? true : undefined}
                  />
                  <p id="src-text-hint" className="field-hint">Rendered with every script and network request blocked. JSX is read statically, never compiled or executed. Up to 300,000 characters.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="btn btn-secondary btn-sm cursor-pointer focus-within:outline focus-within:outline-[3px] focus-within:outline-[var(--focus)]">
                    <Upload aria-hidden="true" size={14} />
                    Upload a file
                    <input
                      type="file"
                      className="sr-only"
                      accept=".html,.htm,.jsx,.tsx,.css"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void readFile(f, (t) => { setSource(t); setFileName(f.name); });
                      }}
                    />
                  </label>
                  <span className="text-xs text-ink-3">or load an example:</span>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setSource(SAMPLE_HTML); setFileName("newsletter.html"); setDialect("auto"); }}>HTML form</button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setSource(SAMPLE_JSX); setFileName("BookingCard.tsx"); setDialect("auto"); }}>React component</button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setSource(SAMPLE_CSS); setFileName("booking.css"); setDialect("auto"); }}>Stylesheet</button>
                </div>
                {fieldError ? <FieldError id={fieldErrId}>{fieldError}</FieldError> : null}
                <div>
                  <button type="submit" className="btn btn-primary" disabled={running}>Check source</button>
                </div>
              </form>
            ) : null}

            {method === "figma" ? (
              <div className="flex flex-col gap-8">
                <form onSubmit={submitFigmaUrl} noValidate className="flex flex-col gap-4">
                  <h2 className="text-lg">Import from Figma</h2>
                  {status && !status.figma.configured ? (
                    <Notice tone="info" title="Live import is not set up on this server">
                      Add a Figma personal access token as <code>FIGMA_ACCESS_TOKEN</code> in the server environment and restart. The token stays on the server. Until then, upload a JSON export below.
                    </Notice>
                  ) : null}
                  <div>
                    <label htmlFor="figma-url" className="field-label">Figma file link</label>
                    <input id="figma-url" className="input" type="url" placeholder="https://www.figma.com/design/FILEKEY/Name?node-id=12-34" value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} disabled={!status?.figma.configured} aria-describedby="figma-url-hint" />
                    <p id="figma-url-hint" className="field-hint">Include ?node-id= to check one frame. Whole files are read to a limited depth.</p>
                  </div>
                  <div>
                    <button type="submit" className="btn btn-primary" disabled={running || !status?.figma.configured}>Import and check</button>
                  </div>
                </form>
                <div className="flex flex-col gap-4 border-t border-line pt-6">
                  <h2 className="text-lg">Check a JSON export</h2>
                  <p className="max-w-[64ch] text-sm text-ink-2">
                    Use the response of the Figma REST API (<code>GET /v1/files/:key</code> or <code>/v1/files/:key/nodes</code>). The file is analysed in this browser and never uploaded.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="btn btn-secondary btn-sm cursor-pointer focus-within:outline focus-within:outline-[3px] focus-within:outline-[var(--focus)]">
                      <Upload aria-hidden="true" size={14} />
                      Choose JSON file
                      <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f, (t) => setFigmaJson({ name: f.name, text: t })); }} />
                    </label>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={async () => {
                        const r = await fetch("/samples/figma-sample.json");
                        setFigmaJson({ name: "figma-sample.json (sample design)", text: await r.text() });
                      }}
                    >
                      Load the sample design
                    </button>
                    <span className="text-sm text-ink-2" aria-live="polite">{figmaJson ? `Selected: ${figmaJson.name}` : "No file selected"}</span>
                  </div>
                  {fieldError ? <FieldError id={fieldErrId}>{fieldError}</FieldError> : null}
                  <div>
                    <button type="button" className="btn btn-primary" disabled={running || !figmaJson} onClick={submitFigmaJson}>Check design</button>
                  </div>
                </div>
              </div>
            ) : null}

            {method === "fixture" ? (
              <div className="flex flex-col gap-4">
                <p className="max-w-[64ch] text-ink-2">
                  The bundled test page is a fictional clinic booking page with about twenty deliberate defects. Scanning it runs the real browser and rule engine, so it is a quick way to see the full journey without scanning a live site.
                </p>
                <div>
                  <button type="button" className="btn btn-primary" disabled={running} onClick={submitFixture}>Scan the test page</button>
                </div>
              </div>
            ) : null}
          </Tabs>

          {running ? (
            <div className="mt-6 rounded-[var(--radius-control)] border border-line bg-surface-2 p-4" role="status">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Spinner label={`Running audit, ${elapsed} s elapsed`} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => abortRef.current?.abort()}>
                  <Square aria-hidden="true" size={12} />
                  Cancel
                </button>
              </div>
              <p className="mt-3 text-sm text-ink-2">This audit will:</p>
              <ol className="mt-1 list-decimal pl-5 text-sm text-ink-2">
                {STEPS[method].map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
          ) : null}

          {error ? (
            <div ref={errorRef} tabIndex={-1} className="mt-6 outline-none">
              <Notice tone="error" title="The audit did not run" role="alert">{error}</Notice>
            </div>
          ) : null}
        </div>

        <aside aria-labelledby="options-heading" className="flex flex-col gap-6">
          <div className="panel p-5">
            <h2 id="options-heading" className="mb-4 text-lg">Audit options</h2>
            <div className="flex flex-col gap-5">
              <Fieldset legend="Standard">
                <div className="flex flex-col gap-2">
                  {PROFILE_IDS.map((id) => (
                    <label key={id} className="flex items-start gap-2.5 text-sm">
                      <input type="radio" name="profile" value={id} className="mt-1 size-4 accent-[var(--accent)]" checked={profile === id} onChange={() => setProfile(id)} />
                      <span>
                        <span className="font-semibold">{PROFILES[id].label}</span>
                        <span className="block text-xs text-ink-3">{PROFILES[id].description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Fieldset>
              <div>
                <label htmlFor="viewport" className="field-label">Viewport</label>
                <select id="viewport" className="input" value={viewport} onChange={(e) => setViewport(e.target.value as typeof viewport)} disabled={method === "figma"}>
                  <option value="desktop">Desktop, 1280 by 800</option>
                  <option value="tablet">Tablet, 820 by 1180</option>
                  <option value="mobile">Mobile, 390 by 844</option>
                </select>
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={includeBP} onChange={(e) => setIncludeBP(e.target.checked)} />
                <span>
                  Include best-practice checks
                  <span className="block text-xs text-ink-3">Reported separately from success criteria.</span>
                </span>
              </label>
            </div>
          </div>
          <p className="px-1 text-xs text-ink-3">
            Passing automated checks is not the same as conforming to a standard. Every report lists what needs a person.
          </p>
        </aside>
      </div>
    </>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error" role="alert">
      {children}
    </p>
  );
}
