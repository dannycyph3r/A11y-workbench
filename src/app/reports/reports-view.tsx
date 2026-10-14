"use client";

import { useMemo } from "react";
import { Download, Printer } from "lucide-react";
import { useStore } from "@/components/store";
import { NoAudit, formatDate } from "@/components/audit-bits";
import { DemoBadge, ImpactBadge, KindBadge, Notice, PageHeader, VerifyBadge } from "@/components/ui";
import { downloadText, slugFile } from "@/components/client-utils";
import { buildReport, reportToCsv } from "@/lib/report/report";

export function ReportsView() {
  const { ready, current, remediation, settings } = useStore();
  const report = useMemo(
    () => (current ? buildReport(current, remediation(current.id), { defaultLang: settings.defaultLang }) : null),
    [current, remediation, settings.defaultLang],
  );

  if (!ready) return <p role="status">Loading your session</p>;
  if (!current || !report) return <><PageHeader title="Reports" /><NoAudit what="in a report" /></>;

  const base = `a11y-report-${slugFile(report.target)}-${current.createdAt.slice(0, 10)}`;
  const stale = remediation(current.id).verification?.stale;

  return (
    <>
      <PageHeader
        title="Report"
        description="Everything in the current audit: scope, findings, fixes, verification and what still needs a person. Exports contain exactly what is shown here."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => downloadText(`${base}.json`, JSON.stringify(report, null, 2), "application/json")}>
              <Download aria-hidden="true" size={16} />
              Download JSON
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => downloadText(`${base}.csv`, reportToCsv(report), "text/csv")}>
              <Download aria-hidden="true" size={16} />
              Download CSV
            </button>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <Printer aria-hidden="true" size={16} />
              Print or save as PDF
            </button>
          </>
        }
      />
      {stale ? <div className="mb-4 no-print"><Notice tone="warning">Accepted fixes changed after the last rerun, so verification results are left out. Verify again in the workspace to include them.</Notice></div> : null}

      <article aria-labelledby="report-title" className="flex flex-col gap-6">
        <header className="panel p-5 sm:p-6">
          <h2 id="report-title" className="text-xl">
            Accessibility audit report {report.demo ? <DemoBadge /> : null}
          </h2>
          {report.demo ? <p className="mt-2 text-sm font-semibold">Demo data from a bundled sample page. Not a scan of a live site.</p> : null}
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ["Target", report.target],
              ["Audited", formatDate(report.auditedAt)],
              ["Report generated", formatDate(report.generatedAt)],
              ["Standard", report.standard.profile],
              ["Engine", `${report.engine.name} ${report.engine.version}${report.engine.browser ? `, Chromium ${report.engine.browser}` : ""}, ${report.generator}`],
              ["Tested state", report.scope.pageState],
              ["Viewport", report.scope.viewport ? `${report.scope.viewport.width} by ${report.scope.viewport.height} CSS pixels` : "Not applicable"],
              ["Rules run", String(report.scope.rulesRun)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold text-ink-3">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-2"><strong>Basis:</strong> {report.standard.basis}</p>
        </header>

        <section aria-labelledby="summary-h" className="panel p-5 sm:p-6">
          <h2 id="summary-h" className="text-lg">Summary</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {[
              ["Findings", report.summary.total],
              ["Violations", report.summary.byKind.violation ?? 0],
              ["Heuristic warnings", report.summary.byKind.heuristic ?? 0],
              ["Needs review", report.summary.byKind["needs-review"] ?? 0],
              ["Inconclusive", report.summary.byKind.inconclusive ?? 0],
              ["Fixes accepted", report.summary.accepted],
              ["Resolved on rerun", report.summary.resolved],
              ["Introduced by patch", report.summary.introducedByPatch],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold text-ink-3">{k}</dt>
                <dd className="text-xl font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {report.scope.notes.length ? <ul className="mt-4 list-disc pl-5 text-sm text-ink-2">{report.scope.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          {report.warnings.length ? <div className="mt-4"><Notice tone="warning" title="Partial results">{report.warnings.map((w) => <p key={w}>{w}</p>)}</Notice></div> : null}
        </section>

        <section aria-labelledby="findings-h" className="panel overflow-hidden">
          <h2 id="findings-h" className="p-5 pb-3 text-lg sm:px-6">Findings</h2>
          {report.findings.length ? (
            <div className="overflow-x-auto" role="region" aria-label="Findings table" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Issue and element</th>
                    <th scope="col">Impact</th>
                    <th scope="col">Criteria</th>
                    <th scope="col">Fix</th>
                    <th scope="col">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((f) => (
                    <tr key={f.id}>
                      <td className="min-w-[260px]">
                        <p className="font-semibold">{f.title}</p>
                        <div className="mt-1"><KindBadge kind={f.kind} /></div>
                        <code className="mt-1 block break-all text-xs text-ink-3">{f.selector}{f.location ? `, ${f.location}` : ""}</code>
                      </td>
                      <td><ImpactBadge impact={f.impact} /></td>
                      <td className="text-xs">{f.criteria.length ? f.criteria.join("; ") : "Best practice"}</td>
                      <td className="min-w-[200px] text-xs">
                        <span className="font-semibold capitalize">{f.fixDecision}</span>
                        {f.proposedFix ? <span className="block text-ink-2">{f.proposedFix}</span> : null}
                      </td>
                      <td><VerifyBadge status={f.verification} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-6 pb-6 text-ink-2">The automated checks found nothing on the tested scope.</p>
          )}
        </section>

        <section aria-labelledby="manual-h" className="panel p-5 sm:p-6">
          <h2 id="manual-h" className="text-lg">Manual review checklist</h2>
          <p className="mt-1 text-sm text-ink-2">
            Every criterion in {report.standard.profile} needs a person to confirm it. Criteria marked &ldquo;partly automated&rdquo; had automated rules run; the rest had none.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {report.manualReviewChecklist.map((c) => (
              <li key={c.criterion} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[minmax(0,260px)_1fr_auto] sm:gap-4">
                <span className="font-semibold"><span className="font-mono">{c.criterion}</span> {c.title}</span>
                <span className="text-ink-2">{c.prompt}</span>
                <span className="text-xs text-ink-3">{c.automatedCoverage === "partial" ? "Partly automated" : "Manual only"}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="limits-h" className="panel p-5 sm:p-6">
          <h2 id="limits-h" className="text-lg">Limitations</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="mt-4 rounded border border-line-control p-3 text-sm font-semibold">{report.notice}</p>
        </section>
      </article>
    </>
  );
}
