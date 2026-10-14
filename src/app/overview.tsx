"use client";

import Link from "next/link";
import { CodeXml, FlaskConical, Globe, PenTool, Trash2 } from "lucide-react";
import { useStore } from "@/components/store";
import { AuditMeta, CriteriaMap, formatDate, groupByRule } from "@/components/audit-bits";
import { DemoBadge, IMPACT_META, ImpactBadge, Notice, PageHeader, SectionHeading } from "@/components/ui";
import { IMPACT_ORDER } from "@/lib/findings/normalize";
import { auditTarget } from "@/lib/report/report";
import { PROFILES } from "@/lib/standards/profiles";
import type { Audit, Impact } from "@/lib/findings/types";

const START = [
  { method: "url", icon: Globe, title: "Scan a web page", body: "Render one public page in an isolated browser and run WCAG A and AA rules, a keyboard walk and contrast checks." },
  { method: "source", icon: CodeXml, title: "Check component source", body: "Paste HTML, JSX, TSX or CSS. It is rendered with scripts blocked and every finding points to a line." },
  { method: "figma", icon: PenTool, title: "Check a Figma design", body: "Measure text contrast and target sizes from design layers before anything is built." },
];

export function Overview() {
  const { ready, current, audits, loadDemo, setCurrent, removeAudit, remediation, persistWarning } = useStore();

  if (!ready) {
    return <p className="text-ink-2" role="status">Loading your session</p>;
  }

  if (!current) {
    return (
      <>
        <PageHeader
          title="Find it, fix it, prove it"
          description="A11y Workbench audits pages, components and designs against WCAG 2.2 AA and AODA, proposes code fixes as diffs you approve, and reruns the checks to show what each fix actually resolved."
        />
        <h2 className="sr-only">Start an audit</h2>
        <ul className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-3">
          {START.map(({ method, icon: Icon, title, body }) => (
            <li key={method} className="flex flex-col gap-3 bg-surface p-6">
              <Icon aria-hidden="true" size={22} className="text-accent-ink" />
              <h3 className="text-lg">
                <Link href={`/audit/new?method=${method}`} className="underline decoration-line-control decoration-2 underline-offset-4 hover:decoration-accent">
                  {title}
                </Link>
              </h3>
              <p className="text-sm text-ink-2">{body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-4 rounded-[var(--radius-panel)] border border-dashed border-line-control p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-[60ch]">
            <h2 className="text-lg">Not ready to scan anything yet?</h2>
            <p className="mt-1 text-sm text-ink-2">Open a demo audit of a fictional clinic booking page. It is clearly marked as sample data throughout.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => loadDemo()}>
              <FlaskConical aria-hidden="true" size={16} />
              Open the demo audit
            </button>
            <Link href="/audit/new?method=fixture" className="btn btn-secondary">Scan the test page live</Link>
          </div>
        </div>
        <p className="mt-8 max-w-[72ch] text-sm text-ink-3">
          Automated testing finds a portion of accessibility barriers. No result here is a certification of conformance with WCAG or the AODA; every report lists the criteria a person still has to check.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <>
            <Link href="/findings" className="btn btn-primary">Review findings</Link>
            <Link href="/audit/new" className="btn btn-secondary">New audit</Link>
          </>
        }
      />
      {persistWarning ? <div className="mb-4"><Notice tone="warning">{persistWarning}</Notice></div> : null}
      <div className="flex flex-col gap-6">
        <section aria-labelledby="audit-heading" className="panel p-5 sm:p-6">
          <h2 id="audit-heading" className="sr-only">Current audit</h2>
          <AuditMeta audit={current} />
        </section>
        <Summary audit={current} accepted={Object.values(remediation(current.id).fixes).filter((f) => f.decision === "accepted").length} verification={remediation(current.id).verification} />
        <CriteriaMap audit={current} />
        <TopIssues audit={current} />
        {audits.length > 1 ? (
          <section aria-labelledby="recent-heading" className="panel p-5 sm:p-6">
            <SectionHeading id="recent-heading">Audits in this session</SectionHeading>
            <ul className="divide-y divide-line">
              {audits.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-all font-semibold">{auditTarget(a)} {a.isDemo ? <DemoBadge /> : null}</p>
                    <p className="text-xs text-ink-3">{formatDate(a.createdAt)}, {PROFILES[a.profile].shortLabel}, {a.findings.length} findings</p>
                  </div>
                  <div className="flex gap-2">
                    {a.id === current.id ? (
                      <span className="text-sm font-semibold text-accent-ink">Current</span>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCurrent(a.id)}>Make current</button>
                    )}
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeAudit(a.id)} aria-label={`Remove audit of ${auditTarget(a)}`}>
                      <Trash2 aria-hidden="true" size={14} />
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

function Summary({ audit, accepted, verification }: { audit: Audit; accepted: number; verification?: { results: { status: string }[]; stale: boolean } }) {
  const f = audit.findings;
  const byKind = {
    Violations: f.filter((x) => x.kind === "violation").length,
    Heuristics: f.filter((x) => x.kind === "heuristic").length,
    "Needs review": f.filter((x) => x.kind === "needs-review").length,
    Inconclusive: f.filter((x) => x.kind === "inconclusive").length,
  };
  const impacts: Impact[] = ["critical", "serious", "moderate", "minor"];
  const resolved = verification && !verification.stale ? verification.results.filter((r) => r.status === "resolved").length : 0;
  return (
    <section aria-labelledby="summary-heading" className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="panel p-5 sm:p-6">
        <h2 id="summary-heading" className="text-lg">{f.length} findings</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(byKind).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-ink-3">{k}</dt>
              <dd className="text-2xl font-bold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-6 text-sm text-ink-2">By impact</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {impacts.map((i) => {
            const n = f.filter((x) => x.impact === i).length;
            return (
              <li key={i}>
                <Link href={`/findings?impact=${i}`} className="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
                  <ImpactBadge impact={i} />
                  <span className="font-semibold tabular-nums">{n}</span>
                  <span className="sr-only"> {IMPACT_META[i].label.toLowerCase()} findings</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel p-5 sm:p-6">
        <h2 className="text-lg">Remediation</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs font-semibold text-ink-3">Fixes accepted</dt>
            <dd className="text-2xl font-bold tabular-nums">{accepted}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-3">Resolved on rerun</dt>
            <dd className="text-2xl font-bold tabular-nums">{verification && !verification.stale ? resolved : "None yet"}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-ink-2">
          {audit.document
            ? verification?.stale
              ? "Accepted fixes changed since the last rerun. Verify again to update the results."
              : "Accept fixes in the workspace, then rerun the checks to confirm what they resolve."
            : "This audit has no editable document, so fixes are guidance only."}
        </p>
        {audit.document ? <Link href="/workspace" className="btn btn-secondary mt-4">Open the workspace</Link> : null}
      </div>
    </section>
  );
}

function TopIssues({ audit }: { audit: Audit }) {
  const groups = groupByRule(audit.findings)
    .map((g) => ({ ...g, worst: g.items.reduce((w, x) => (IMPACT_ORDER[x.impact] < IMPACT_ORDER[w] ? x.impact : w), "minor" as Impact) }))
    .sort((a, b) => IMPACT_ORDER[a.worst] - IMPACT_ORDER[b.worst] || b.items.length - a.items.length)
    .slice(0, 8);
  if (!groups.length) {
    return (
      <Notice tone="success" title="The automated checks found nothing">
        That is a good start, not a result. Work through the manual checklist in the report before drawing conclusions.
      </Notice>
    );
  }
  return (
    <section aria-labelledby="top-heading" className="panel p-5 sm:p-6">
      <SectionHeading id="top-heading" aside={<Link href="/findings" className="text-sm font-semibold text-accent-ink underline underline-offset-4">All findings</Link>}>
        Where to start
      </SectionHeading>
      <ol className="divide-y divide-line">
        {groups.map((g) => (
          <li key={g.ruleId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link href={`/findings?rule=${g.ruleId}`} className="font-semibold hover:underline">{g.title}</Link>
              <p className="text-xs text-ink-3">{g.items[0]!.criteria.map((c) => `${c.id} ${c.title}`).join(", ") || "Best practice"}</p>
            </div>
            <div className="flex items-center gap-3">
              <ImpactBadge impact={g.worst} />
              <span className="w-24 text-right text-sm tabular-nums text-ink-2">{g.items.length} {g.items.length === 1 ? "element" : "elements"}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
