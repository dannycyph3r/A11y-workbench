"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Sparkles, Wrench } from "lucide-react";
import { useStore } from "@/components/store";
import { useAnnounce } from "@/components/shell";
import { AuditMeta, ContrastRuler, NoAudit } from "@/components/audit-bits";
import { ConfidenceBadge, ImpactBadge, KindBadge, KIND_META, Notice, PageHeader, VerifyBadge } from "@/components/ui";
import { postJson, useServerStatus } from "@/components/client-utils";
import { IMPACT_ORDER } from "@/lib/findings/normalize";
import { getCriterion, understandingUrl } from "@/lib/standards/wcag";
import { proposeFix } from "@/lib/remediation/engine";
import type { Audit, Category, Finding, FindingKind, Impact, VerificationStatus } from "@/lib/findings/types";

type SortKey = "impact" | "issue" | "criterion";

const CATEGORY_LABEL: Record<Category, string> = {
  contrast: "Contrast",
  semantics: "Semantics",
  aria: "ARIA and names",
  forms: "Forms",
  keyboard: "Keyboard and focus",
  images: "Images",
  structure: "Structure",
  language: "Language",
  media: "Media",
  "target-size": "Target size",
  other: "Other",
};

export function FindingsView() {
  const { ready, current, remediation, settings } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const announce = useAnnounce();

  const [q, setQ] = useState("");
  const [impact, setImpact] = useState<string>(params.get("impact") ?? "all");
  const [kind, setKind] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [criterion, setCriterion] = useState<string>(params.get("criterion") ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [rule, setRule] = useState<string>(params.get("rule") ?? "all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "impact", dir: "asc" });
  const selectedId = params.get("id");
  const detailRef = useRef<HTMLDivElement>(null);

  const rem = current ? remediation(current.id) : undefined;
  const verification = rem?.verification && !rem.verification.stale ? rem.verification : undefined;
  const statusOf = (f: Finding): VerificationStatus => verification?.results.find((r) => r.findingId === f.id)?.status ?? f.verification;

  const filtered = useMemo(() => {
    if (!current) return [];
    const needle = q.trim().toLowerCase();
    const list = current.findings.filter((f) => {
      if (impact !== "all" && f.impact !== impact) return false;
      if (kind !== "all" && f.kind !== kind) return false;
      if (category !== "all" && f.category !== category) return false;
      if (rule !== "all" && f.ruleId !== rule) return false;
      if (criterion !== "all" && !(criterion === "best-practice" ? f.isBestPractice : f.criteria.some((c) => c.id === criterion))) return false;
      if (status !== "all" && statusOf(f) !== status) return false;
      if (needle && !`${f.title} ${f.ruleId} ${f.node.selector} ${f.node.html}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.key === "issue") return dir * a.title.localeCompare(b.title);
      if (sort.key === "criterion") return dir * (a.criteria[0]?.id ?? "9").localeCompare(b.criteria[0]?.id ?? "9", undefined, { numeric: true });
      return dir * (IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]) || a.title.localeCompare(b.title);
    });
    // statusOf depends on verification, captured via rem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, q, impact, kind, category, criterion, status, rule, sort, rem]);

  const total = current?.findings.length ?? 0;
  useEffect(() => {
    if (!current) return;
    announce(`${filtered.length} of ${total} findings shown.`);
  }, [filtered.length, total, current, announce]);

  if (!ready) return <p role="status">Loading your session</p>;
  if (!current) return <><PageHeader title="Findings" /><NoAudit what="here yet" /></>;

  const selected = current.findings.find((f) => f.id === selectedId) ?? null;
  const criteriaInAudit = [...new Set(current.findings.flatMap((f) => f.criteria.map((c) => c.id)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rules = [...new Set(current.findings.map((f) => f.ruleId))].sort();

  const select = (id: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("id", id);
    router.replace(`/findings?${p.toString()}`, { scroll: false });
    requestAnimationFrame(() => detailRef.current?.focus());
  };

  const clearFilters = () => {
    setQ("");
    setImpact("all");
    setKind("all");
    setCategory("all");
    setCriterion("all");
    setStatus("all");
    setRule("all");
  };

  const sortHeader = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 font-semibold hover:text-ink" onClick={() => setSort({ key, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
          {label}
          <Icon aria-hidden="true" size={13} />
        </button>
      </th>
    );
  };

  const filtersActive = [impact, kind, category, criterion, status, rule].some((v) => v !== "all") || q;

  return (
    <>
      <PageHeader title="Findings" description={`${total} findings from the current audit. Select one to see its evidence and recommended fix.`} actions={current.document ? <Link href="/workspace" className="btn btn-primary"><Wrench aria-hidden="true" size={16} />Open workspace</Link> : undefined} />
      <details className="panel mb-6 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Audit details and scope</summary>
        <div className="mt-4"><AuditMeta audit={current} /></div>
        <p className="mt-4 text-ink-2">{current.scope.pageState}</p>
        <ul className="mt-2 list-disc pl-5 text-ink-2">{current.scope.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        {current.warnings.length ? <div className="mt-3"><Notice tone="warning" title="Partial results">{current.warnings.map((w) => <p key={w}>{w}</p>)}</Notice></div> : null}
      </details>

      <form role="search" aria-label="Filter findings" className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" onSubmit={(e) => e.preventDefault()}>
        <div className="sm:col-span-2 lg:col-span-4 xl:col-span-1">
          <label htmlFor="f-q" className="field-label">Search</label>
          <input id="f-q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rule, element or text" />
        </div>
        <Select id="f-impact" label="Impact" value={impact} onChange={setImpact} options={[["all", "All"], ...(["critical", "serious", "moderate", "minor"] as Impact[]).map((i) => [i, i[0]!.toUpperCase() + i.slice(1)] as [string, string])]} />
        <Select id="f-kind" label="Result type" value={kind} onChange={setKind} options={[["all", "All"], ...(Object.keys(KIND_META) as FindingKind[]).map((k) => [k, KIND_META[k].label] as [string, string])]} />
        <Select id="f-cat" label="Category" value={category} onChange={setCategory} options={[["all", "All"], ...[...new Set(current.findings.map((f) => f.category))].map((c) => [c, CATEGORY_LABEL[c]] as [string, string])]} />
        <Select id="f-crit" label="Criterion" value={criterion} onChange={setCriterion} options={[["all", "All"], ...criteriaInAudit.map((id) => [id, `${id} ${getCriterion(id)?.title ?? ""}`] as [string, string]), ["best-practice", "Best practice only"]]} />
        <Select id="f-rule" label="Rule" value={rule} onChange={setRule} options={[["all", "All"], ...rules.map((r) => [r, r] as [string, string])]} />
        <Select id="f-status" label="Status" value={status} onChange={setStatus} options={[["all", "All"], ["unverified", "Not verified"], ["resolved", "Resolved on rerun"], ["still-failing", "Still failing"], ["not-testable", "Needs manual check"]]} />
      </form>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-ink-2">Showing <strong className="text-ink">{filtered.length}</strong> of {total}</p>
        {filtersActive ? <button type="button" className="btn btn-quiet btn-sm" onClick={clearFilters}>Clear filters</button> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8">
              <p className="font-semibold">{total === 0 ? "The automated checks found nothing on this target." : "No findings match these filters."}</p>
              <p className="mt-1 text-sm text-ink-2">{total === 0 ? "Work through the manual checklist in Reports; most criteria need a person." : "Clear a filter to see more."}</p>
            </div>
          ) : (
            <div className="max-h-[72vh] overflow-auto" tabIndex={0} role="region" aria-label="Findings table">
              <table className="data-table">
                <caption className="sr-only">Findings, sorted by {sort.key}. Select an issue to view details.</caption>
                <thead>
                  <tr>
                    {sortHeader("issue", "Issue")}
                    {sortHeader("impact", "Impact")}
                    {sortHeader("criterion", "Criterion")}
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} data-selected={f.id === selectedId ? "true" : undefined}>
                      <td className="min-w-[240px]">
                        <button type="button" className="text-left font-semibold text-ink hover:underline" onClick={() => select(f.id)} aria-current={f.id === selectedId ? "true" : undefined}>
                          {f.title}
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <KindBadge kind={f.kind} />
                          {f.isBestPractice ? <span className="text-xs text-ink-3">Best practice</span> : null}
                        </div>
                        <code className="mt-1 block break-all text-xs text-ink-3">{f.node.selector}</code>
                      </td>
                      <td><ImpactBadge impact={f.impact} /></td>
                      <td className="whitespace-nowrap font-mono text-xs">{f.criteria.map((c) => c.id).join(", ") || "None"}</td>
                      <td><VerifyBadge status={statusOf(f)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div ref={detailRef} tabIndex={-1} className="outline-none xl:sticky xl:top-6 xl:self-start" aria-live="off">
          {selected ? (
            <FindingDetail finding={selected} audit={current} status={statusOf(selected)} defaultLang={settings.defaultLang} note={verification?.results.find((r) => r.findingId === selected.id)?.note} />
          ) : (
            <div className="panel p-6 text-ink-2">
              <h2 className="text-lg text-ink">No finding selected</h2>
              <p className="mt-1 text-sm">Choose an issue in the table to see what it affects, the evidence, and how to fix it.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function FindingDetail({ finding: f, audit, status, defaultLang, note }: { finding: Finding; audit: Audit; status: VerificationStatus; defaultLang: string; note?: string }) {
  const fix = proposeFix(f, audit.document, {}, { defaultLang });
  const { status: server } = useServerStatus();
  const [ai, setAi] = useState<{ loading: boolean; text?: string; error?: string }>({ loading: false });
  const c = f.node.contrast;

  async function explain() {
    setAi({ loading: true });
    const r = await postJson<{ text: string }>("/api/explain", { finding: f });
    setAi(r.ok ? { loading: false, text: r.data.text } : { loading: false, error: r.message });
  }

  return (
    <article aria-labelledby="detail-title" className="panel p-5 sm:p-6">
      <div className="flex flex-wrap gap-1.5">
        <ImpactBadge impact={f.impact} />
        <KindBadge kind={f.kind} />
        <VerifyBadge status={status} />
      </div>
      <h2 id="detail-title" className="mt-3 text-xl">{f.title}</h2>
      <p className="mt-2 text-ink-2">{f.description}</p>
      {note ? <p className="mt-2 text-sm text-ink-3">Rerun: {note}</p> : null}

      <h3 className="mt-6 text-sm text-ink-2">Affected element</h3>
      <code className="mt-1 block break-all text-xs text-ink-3">{f.node.selector}{f.node.location ? `, line ${f.node.location.line}` : ""}</code>
      <pre className="code mt-2"><code>{f.node.html}</code></pre>

      {c ? (
        <>
          <h3 className="mt-6 text-sm text-ink-2">Contrast</h3>
          <div className="mt-3">
            <ContrastRuler ratio={c.ratio} required={c.required} foreground={c.foreground} background={c.background} after={fix?.color?.ratioAfter} afterColor={fix?.color?.to} />
          </div>
          {c.note ? <p className="mt-2 text-sm text-ink-2">{c.note}</p> : null}
        </>
      ) : null}

      <h3 className="mt-6 text-sm text-ink-2">Standard</h3>
      {f.criteria.length ? (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {f.criteria.map((cr) => {
            const full = getCriterion(cr.id);
            return (
              <li key={cr.id}>
                <a href={full ? understandingUrl(full) : "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-ink underline underline-offset-4">
                  {cr.id} {cr.title} (Level {cr.level})
                  <ExternalLink aria-hidden="true" size={13} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                {!cr.inProfile ? <span className="ml-2 text-xs text-ink-3">outside the selected standard</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-sm">Best practice. Not a WCAG success criterion.</p>
      )}

      {f.node.evidence.length ? (
        <>
          <h3 className="mt-6 text-sm text-ink-2">Evidence</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">{f.node.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        </>
      ) : null}

      <h3 className="mt-6 text-sm text-ink-2">Recommended fix</h3>
      <p className="mt-1">{f.recommendation}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={fix?.confidence ?? f.fixConfidence} />
      </div>
      {f.manualReview.length ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-ink-2">{f.manualReview.map((m) => <li key={m}>{m}</li>)}</ul>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {fix && audit.document ? (
          <Link href={`/workspace?finding=${f.id}`} className="btn btn-primary">
            <Wrench aria-hidden="true" size={16} />
            {fix.needsInput ? "Write the fix" : "Review the proposed fix"}
          </Link>
        ) : (
          <p className="text-sm text-ink-2">{audit.document ? "No automatic fix for this rule. Follow the guidance above." : "This audit has no editable document; fix it at the source."}</p>
        )}
        {f.helpUrl ? (
          <a href={f.helpUrl} target="_blank" rel="noreferrer" className="btn btn-quiet">
            Rule documentation
            <ExternalLink aria-hidden="true" size={13} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>

      {server?.ai.configured && f.fixConfidence === "manual" ? (
        <div className="mt-6 border-t border-line pt-4">
          <button type="button" className="btn btn-secondary btn-sm" onClick={explain} disabled={ai.loading}>
            <Sparkles aria-hidden="true" size={14} />
            {ai.loading ? "Asking" : "Explain with AI"}
          </button>
          <p className="mt-2 text-xs text-ink-3">Sends this finding&apos;s markup and evidence to {server.ai.provider}. The answer is advice, not a verified fix.</p>
          <div aria-live="polite">
            {ai.text ? <div className="mt-3 whitespace-pre-wrap rounded border border-line bg-surface-2 p-3 text-sm">{ai.text}</div> : null}
            {ai.error ? <p className="field-error">{ai.error}</p> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
