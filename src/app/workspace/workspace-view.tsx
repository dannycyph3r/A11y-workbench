"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Check, Copy, Download, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useStore } from "@/components/store";
import { useAnnounce } from "@/components/shell";
import { ContrastRuler, NoAudit } from "@/components/audit-bits";
import { DiffView } from "@/components/diff-view";
import { ConfidenceBadge, ImpactBadge, Notice, PageHeader, Spinner, VerifyBadge } from "@/components/ui";
import { copyText, downloadText, postJson } from "@/components/client-utils";
import { composeAccepted, previewFix, proposeFix, type ComposedPatch } from "@/lib/remediation/engine";
import type { ProposedFix } from "@/lib/remediation/fixers";
import { unifiedPatch } from "@/lib/remediation/diff";
import type { VerificationResult } from "@/lib/remediation/verify-types";
import type { Audit, Finding, VerificationStatus } from "@/lib/findings/types";
import type { FixState } from "@/lib/remediation/engine";

type Group = "input" | "ready" | "accepted" | "rejected" | "guidance";

const GROUP_LABEL: Record<Group, string> = {
  ready: "Ready to review",
  input: "Needs your input",
  accepted: "Accepted",
  rejected: "Rejected",
  guidance: "Guidance only",
};

interface Item {
  finding: Finding;
  fix: ProposedFix | null;
  state: FixState;
  group: Group;
}

export function WorkspaceView() {
  const { ready, current, remediation, dispatch, settings } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const announce = useAnnounce();
  // Side by side needs width; narrow screens start in unified view.
  const [mode, setMode] = useState<"split" | "unified">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches ? "unified" : "split",
  );
  const [scope, setScope] = useState<"fix" | "all">("fix");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const rem = current ? remediation(current.id) : undefined;
  const doc = current?.document;

  const items: Item[] = useMemo(() => {
    if (!current || !rem) return [];
    return current.findings.map((f) => {
      const state = rem.fixes[f.id] ?? { decision: "proposed", inputs: {} };
      const fix = proposeFix(f, doc, state.inputs, { defaultLang: settings.defaultLang });
      let group: Group;
      if (!fix || (fix.edits.length === 0 && !fix.needsInput)) group = "guidance";
      else if (state.decision === "accepted") group = "accepted";
      else if (state.decision === "rejected") group = "rejected";
      else if (fix.needsInput) group = "input";
      else group = "ready";
      return { finding: f, fix, state, group };
    });
  }, [current, rem, doc, settings.defaultLang]);

  const composed: ComposedPatch | null = useMemo(() => {
    if (!doc || !rem) return null;
    const accepted = rem.acceptedOrder.map((id) => items.find((i) => i.finding.id === id)?.fix).filter((f): f is ProposedFix => Boolean(f));
    try {
      return composeAccepted(doc, accepted);
    } catch {
      return null;
    }
  }, [doc, rem, items]);

  if (!ready) return <p role="status">Loading your session</p>;
  if (!current || !rem) return <><PageHeader title="Remediation workspace" /><NoAudit what="in the workspace" /></>;
  if (!doc) {
    return (
      <>
        <PageHeader title="Remediation workspace" />
        <Notice tone="info" title="This audit has no editable document">
          {current.input.kind === "figma" ? "Design findings are fixed in Figma. Use the findings list for guidance." : "No snapshot was kept for this audit, so fixes can only be described, not generated."}
          <p className="mt-2"><Link href="/findings" className="font-semibold underline underline-offset-4">Go to findings</Link></p>
        </Notice>
      </>
    );
  }

  const selectedId = params.get("finding") ?? items.find((i) => i.group === "ready" || i.group === "input")?.finding.id ?? items[0]?.finding.id;
  const selected = items.find((i) => i.finding.id === selectedId);
  const verification = rem.verification;
  const statusOf = (id: string): VerificationStatus | undefined => (verification && !verification.stale ? verification.results.find((r) => r.findingId === id)?.status : undefined);
  const conflictFor = (id: string) => composed?.conflicts.find((c) => c.findingId === id);
  const acceptedCount = composed?.applied.length ?? 0;

  const select = (id: string) => {
    router.replace(`/workspace?finding=${id}`, { scroll: false });
    requestAnimationFrame(() => detailRef.current?.focus());
  };

  const act = (type: "accept" | "reject" | "reset", id: string, title: string) => {
    dispatch(current.id, { type, findingId: id });
    announce(type === "accept" ? `Accepted the fix for ${title}.` : type === "reject" ? `Rejected the fix for ${title}.` : `Reset ${title}.`);
  };

  async function verify() {
    if (!composed || !doc || !current) return;
    setVerifying(true);
    setVerifyError(null);
    announce("Rerunning checks on the patched document.");
    const r = await postJson<VerificationResult>("/api/verify", {
      document: doc,
      patched: composed.text,
      edits: composed.edits,
      profile: current.profile,
      includeBestPractice: current.includeBestPractice,
      viewport: settings.viewport,
      findings: current.findings.map((f) => ({ id: f.id, ruleId: f.ruleId, node: { selector: f.node.selector, location: f.node.location } })),
    });
    setVerifying(false);
    if (!r.ok) {
      setVerifyError(r.message);
      announce("Verification failed.");
      return;
    }
    dispatch(current.id, { type: "verified", result: r.data });
    const resolved = r.data.results.filter((x) => x.status === "resolved").length;
    announce(`Verification finished. ${resolved} findings resolved, ${r.data.introduced.length} new findings introduced.`);
  }

  const doCopy = async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? key : null);
    announce(ok ? "Copied to the clipboard." : "Copy failed. Select the text and copy it manually.");
    setTimeout(() => setCopied(null), 2000);
  };

  const patchedName = doc.fileName.replace(/(\.[a-z]+)$/i, ".fixed$1");
  const groups: Group[] = ["input", "ready", "accepted", "rejected", "guidance"];

  return (
    <>
      <PageHeader
        title="Remediation workspace"
        description={
          <>
            Editing <code className="font-mono text-sm">{doc.fileName}</code>
            {doc.origin === "url-snapshot" ? ", a snapshot of the rendered page. Changes here never touch the live site; port accepted fixes to your source." : ". Your original text is kept; every change is a proposal until you accept it."}
          </>
        }
      />

      <section aria-labelledby="patch-heading" className="panel mb-6 flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="patch-heading" className="text-lg">Combined patch</h2>
            <p className="text-sm text-ink-2">
              {acceptedCount} accepted fix{acceptedCount === 1 ? "" : "es"} applied
              {composed?.conflicts.length ? `, ${composed.conflicts.length} left out because they overlap an earlier fix` : ""}.
              {verification ? (verification.stale ? " Changed since the last rerun." : ` Last rerun: ${new Date(verification.ranAt).toLocaleTimeString("en-CA", { timeStyle: "short" }).replace(/\.$/, "")}.`) : " Not rerun yet."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={verify} disabled={verifying || acceptedCount === 0}>
              <ShieldCheck aria-hidden="true" size={16} />
              {verifying ? "Rerunning checks" : "Verify accepted fixes"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!composed || acceptedCount === 0} onClick={() => composed && downloadText(`${doc.fileName}.patch`, unifiedPatch(doc.fileName, doc.text, composed.text), "text/x-diff")}>
              <Download aria-hidden="true" size={16} />
              Download .patch
            </button>
            <button type="button" className="btn btn-secondary" disabled={!composed || acceptedCount === 0} onClick={() => composed && downloadText(patchedName, composed.text, doc.dialect === "css" ? "text/css" : "text/plain")}>
              <Download aria-hidden="true" size={16} />
              Download patched file
            </button>
            <button type="button" className="btn btn-quiet" disabled={Object.keys(rem.fixes).length === 0} onClick={() => { dispatch(current.id, { type: "resetAll" }); announce("All decisions reset."); }}>
              <RotateCcw aria-hidden="true" size={16} />
              Reset all
            </button>
          </div>
        </div>
        {verifying ? <div role="status"><Spinner label="Rescanning the original and patched documents under the same conditions" /></div> : null}
        {verifyError ? <Notice tone="error" title="Verification did not run" role="alert">{verifyError}</Notice> : null}
        {verification && !verification.stale ? <VerificationSummary result={verification} audit={current} /> : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <nav aria-label="Fix queue" className="panel max-h-[78vh] overflow-auto p-3">
          {groups.map((g) => {
            const list = items.filter((i) => i.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="mb-3">
                <h2 className="px-2 py-1.5 text-sm text-ink-2">{GROUP_LABEL[g]} <span className="font-normal">({list.length})</span></h2>
                <ul className="flex flex-col gap-0.5">
                  {list.map((i) => {
                    const v = statusOf(i.finding.id);
                    return (
                      <li key={i.finding.id}>
                        <button
                          type="button"
                          onClick={() => select(i.finding.id)}
                          aria-current={i.finding.id === selectedId ? "true" : undefined}
                          className="w-full rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-surface-2 aria-[current=true]:bg-accent-wash aria-[current=true]:shadow-[inset_3px_0_0_var(--accent)]"
                        >
                          <span className="block text-sm font-semibold">{i.finding.title}</span>
                          <span className="block break-all font-mono text-xs text-ink-3">{i.finding.node.selector}</span>
                          {v ? <span className="mt-1 block"><VerifyBadge status={v} /></span> : null}
                          {conflictFor(i.finding.id) ? <span className="mt-1 block text-xs font-semibold text-critical">Overlaps another fix</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div ref={detailRef} tabIndex={-1} className="min-w-0 outline-none">
          {selected ? (
            <FixPanel
              item={selected}
              audit={current}
              composed={composed}
              conflict={conflictFor(selected.finding.id)}
              status={statusOf(selected.finding.id)}
              note={verification && !verification.stale ? verification.results.find((r) => r.findingId === selected.finding.id)?.note : undefined}
              mode={mode}
              setMode={setMode}
              scope={scope}
              setScope={setScope}
              onAct={(t) => act(t, selected.finding.id, selected.finding.title)}
              onInput={(key, value) => dispatch(current.id, { type: "input", findingId: selected.finding.id, key, value })}
              onCopy={doCopy}
              copied={copied}
            />
          ) : (
            <div className="panel p-6"><p>No findings in this audit.</p></div>
          )}
        </div>
      </div>
    </>
  );
}

function VerificationSummary({ result, audit }: { result: VerificationResult; audit: Audit }) {
  const count = (s: VerificationStatus) => result.results.filter((r) => r.status === s).length;
  const title = (id: string) => audit.findings.find((f) => f.id === id)?.title ?? id;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {!result.validation.ok ? (
        <Notice tone="error" title="The patch failed validation" role="alert">{result.validation.errors.map((e) => <p key={e}>{e}</p>)}</Notice>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["resolved", "Resolved on rerun"], ["still-failing", "Still failing"], ["not-testable", "Needs manual check"]] as [VerificationStatus, string][]).map(([s, l]) => (
              <div key={s}>
                <dt className="text-xs font-semibold text-ink-3">{l}</dt>
                <dd className="text-xl font-bold tabular-nums">{count(s)}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-semibold text-ink-3">New findings from the patch</dt>
              <dd className={`text-xl font-bold tabular-nums ${result.introduced.length ? "text-critical" : ""}`}>{result.introduced.length}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-3">
            Findings before: {result.beforeCount}, after: {result.afterCount}. Both versions were rendered offline with scripts blocked using axe-core {result.engine.version}. &ldquo;Resolved&rdquo; means the rule no longer reports that element; it is not a conformance claim.
          </p>
          {result.introduced.length ? (
            <Notice tone="warning" title="The patch introduced new findings">
              <ul className="list-disc pl-5">
                {result.introduced.map((f) => (
                  <li key={f.id}>
                    <strong>{f.title}</strong> on <code className="font-mono text-xs">{f.node.selector}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-2">Review the related fixes. A corrected attribute can expose a deeper problem, which is why every patch is rerun.</p>
            </Notice>
          ) : null}
          {count("still-failing") ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">Show the {count("still-failing")} still failing</summary>
              <ul className="mt-2 list-disc pl-5">{result.results.filter((r) => r.status === "still-failing").map((r) => <li key={r.findingId}>{title(r.findingId)}</li>)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function FixPanel(props: {
  item: Item;
  audit: Audit;
  composed: ComposedPatch | null;
  conflict?: { findingId: string; withFindingId: string };
  status?: VerificationStatus;
  note?: string;
  mode: "split" | "unified";
  setMode: (m: "split" | "unified") => void;
  scope: "fix" | "all";
  setScope: (s: "fix" | "all") => void;
  onAct: (t: "accept" | "reject" | "reset") => void;
  onInput: (key: string, value: string) => void;
  onCopy: (key: string, text: string) => void;
  copied: string | null;
}) {
  const { item, audit, composed, conflict, status, note, mode, setMode, scope, setScope, onAct, onInput, onCopy, copied } = props;
  const { finding: f, fix, state } = item;
  const doc = audit.document!;
  const preview = fix && fix.edits.length ? (() => { try { return previewFix(doc, fix); } catch { return null; } })() : null;
  const conflictTitle = conflict ? audit.findings.find((x) => x.id === conflict.withFindingId)?.title : undefined;
  const showAll = scope === "all" && composed;
  const before = doc.text;
  const after = showAll ? composed.text : (preview ?? doc.text);

  return (
    <article aria-labelledby="fix-title" className="panel flex flex-col gap-5 p-5 sm:p-6">
      <header>
        <div className="flex flex-wrap gap-1.5">
          <ImpactBadge impact={f.impact} />
          {fix ? <ConfidenceBadge confidence={fix.confidence} /> : null}
          {status ? <VerifyBadge status={status} /> : null}
        </div>
        <h2 id="fix-title" className="mt-3 text-xl">{f.title}</h2>
        <p className="mt-1 break-all font-mono text-xs text-ink-3">{f.node.selector}{f.node.location ? `, line ${f.node.location.line}` : ""}</p>
        {note ? <p className="mt-2 text-sm text-ink-2">Rerun: {note}</p> : null}
      </header>

      {!fix || (fix.edits.length === 0 && !fix.needsInput) ? (
        <div className="flex flex-col gap-3">
          <Notice tone="info" title={fix?.color ? "Suggested value, no patch" : "No automatic fix"}>
            {fix?.rationale ?? (f.node.location ? "This rule needs a person: the right change depends on content, design intent or behaviour the scan cannot see." : "This finding could not be traced to a position in the document, so no patch can be generated.")}
          </Notice>
          {fix?.color ? <ContrastRuler ratio={fix.color.ratioBefore} required={fix.color.required} after={fix.color.ratioAfter} foreground={fix.color.from} background={fix.color.background} afterColor={fix.color.to} /> : null}
          <p className="text-sm"><strong>Guidance:</strong> {f.recommendation}</p>
        </div>
      ) : (
        <>
          <div>
            <p className="font-semibold">{fix.summary}</p>
            <p className="mt-1 text-sm text-ink-2">{fix.rationale}</p>
          </div>

          {fix.inputs.length ? (
            <fieldset className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-4">
              <legend className="px-1 text-sm font-semibold">Your input</legend>
              <p className="mb-3 text-xs text-ink-3">A11y never writes this text for you. It needs someone who knows the content.</p>
              <div className="flex flex-col gap-3">
                {fix.inputs.map((inp) =>
                  inp.type === "checkbox" ? (
                    <label key={inp.key} className="flex items-start gap-2.5 text-sm">
                      <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={state.inputs[inp.key] === "true"} onChange={(e) => onInput(inp.key, e.target.checked ? "true" : "")} disabled={state.decision === "accepted"} />
                      {inp.label}
                    </label>
                  ) : (
                    <div key={inp.key}>
                      <label htmlFor={`in-${inp.key}`} className="field-label">{inp.label}{inp.required ? " (required)" : ""}</label>
                      <input
                        id={`in-${inp.key}`}
                        className="input"
                        value={state.inputs[inp.key] ?? inp.defaultValue ?? ""}
                        onChange={(e) => onInput(inp.key, e.target.value)}
                        aria-describedby={inp.help ? `in-${inp.key}-hint` : undefined}
                        disabled={state.decision === "accepted"}
                        maxLength={300}
                      />
                      {inp.help ? <p id={`in-${inp.key}-hint`} className="field-hint">{inp.help}</p> : null}
                    </div>
                  ),
                )}
              </div>
            </fieldset>
          ) : null}

          {fix.color ? (
            <div className="rounded-[var(--radius-control)] border border-line p-4">
              <h3 className="mb-3 text-sm">Colour change</h3>
              <ContrastRuler ratio={fix.color.ratioBefore} required={fix.color.required} after={fix.color.ratioAfter} foreground={fix.color.from} background={fix.color.background} afterColor={fix.color.to} />
              <p className="mt-3 text-xs text-ink-3">
                Moves {fix.color.direction} with the hue held. Visual change (OKLab distance): {fix.color.deltaE.toFixed(3)}. Brand colours are not changed anywhere else.
              </p>
            </div>
          ) : null}

          {fix.warnings.length ? (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {fix.warnings.map((w) => <li key={w} className="border-l-2 border-moderate pl-3">{w}</li>)}
            </ul>
          ) : null}

          {conflict ? <Notice tone="warning" title="Left out of the combined patch">This fix overlaps the accepted fix for &ldquo;{conflictTitle}&rdquo;. Reject one of them to include the other.</Notice> : null}

          <div className="flex flex-wrap gap-2">
            {state.decision === "accepted" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-resolved"><Check aria-hidden="true" size={16} />Accepted</span>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => onAct("accept")} disabled={fix.needsInput || fix.edits.length === 0}>
                <Check aria-hidden="true" size={16} />
                Accept fix
              </button>
            )}
            {state.decision !== "rejected" ? (
              <button type="button" className="btn btn-secondary" onClick={() => onAct("reject")}>
                <X aria-hidden="true" size={16} />
                Reject
              </button>
            ) : (
              <span className="self-center text-sm font-semibold text-ink-2">Rejected</span>
            )}
            {state.decision !== "proposed" || Object.keys(state.inputs).length ? (
              <button type="button" className="btn btn-quiet" onClick={() => onAct("reset")}>
                <RotateCcw aria-hidden="true" size={16} />
                Reset
              </button>
            ) : null}
            {preview ? (
              <button type="button" className="btn btn-quiet" onClick={() => onCopy(f.id, unifiedPatch(doc.fileName, doc.text, preview))}>
                <Copy aria-hidden="true" size={16} />
                {copied === f.id ? "Copied" : "Copy this diff"}
              </button>
            ) : null}
          </div>
          {fix.needsInput ? <p className="text-sm text-ink-2">Fill in the required input to see the change and accept it.</p> : null}
        </>
      )}

      {fix && (preview || showAll) ? (
        <section aria-labelledby="diff-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="diff-heading" className="text-sm">Original and proposed</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <fieldset className="flex gap-3">
                <legend className="sr-only">Show</legend>
                <label className="flex items-center gap-1.5"><input type="radio" name="scope" className="accent-[var(--accent)]" checked={scope === "fix"} onChange={() => setScope("fix")} />This fix</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="scope" className="accent-[var(--accent)]" checked={scope === "all"} onChange={() => setScope("all")} />All accepted</label>
              </fieldset>
              <fieldset className="flex gap-3">
                <legend className="sr-only">Layout</legend>
                <label className="flex items-center gap-1.5"><input type="radio" name="mode" className="accent-[var(--accent)]" checked={mode === "split"} onChange={() => setMode("split")} />Side by side</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="mode" className="accent-[var(--accent)]" checked={mode === "unified"} onChange={() => setMode("unified")} />Unified</label>
              </fieldset>
            </div>
          </div>
          <DiffView before={before} after={after} mode={mode} caption={showAll ? "All accepted changes" : `Proposed change for ${f.title}`} />
          <p className="text-xs text-ink-3">A proposed patch is not a verified fix. Accept it, then use Verify to rerun the checks.</p>
        </section>
      ) : null}
    </article>
  );
}
