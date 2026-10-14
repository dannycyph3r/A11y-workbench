"use client";

import Link from "next/link";
import { FlaskConical, ScanSearch } from "lucide-react";
import type { Audit, Finding } from "@/lib/findings/types";
import { criteriaForProfile, PROFILES } from "@/lib/standards/profiles";
import { auditTarget } from "@/lib/report/report";
import { formatRatio } from "@/lib/contrast/contrast";
import { useStore } from "./store";
import { DemoBadge, EmptyState, Notice } from "./ui";

export function NoAudit({ what }: { what: string }) {
  const { loadDemo } = useStore();
  return (
    <EmptyState
      icon={ScanSearch}
      title={`No audit to show ${what}`}
      actions={
        <>
          <Link href="/audit/new" className="btn btn-primary">Start an audit</Link>
          <button type="button" className="btn btn-secondary" onClick={() => loadDemo()}>
            <FlaskConical aria-hidden="true" size={16} />
            Open the demo audit
          </button>
        </>
      }
    >
      Run an audit on a page, some source code or a design, or open the demo audit to explore with sample data.
    </EmptyState>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

export function AuditMeta({ audit }: { audit: Audit }) {
  const p = PROFILES[audit.profile];
  const items: [string, string][] = [
    ["Target", auditTarget(audit)],
    ["Audited", formatDate(audit.createdAt)],
    ["Standard", p.label],
    ["Engine", `${audit.engine.name} ${audit.engine.version}${audit.engine.browser ? `, Chromium ${audit.engine.browser}` : ""}`],
  ];
  if (audit.scope.viewport) items.push(["Viewport", `${audit.scope.viewport.width} by ${audit.scope.viewport.height}`]);
  return (
    <div className="flex flex-col gap-3">
      {audit.isDemo ? (
        <Notice tone="info" title="You are looking at demo data">
          These findings were recorded from a real scan of a bundled sample page for a fictional clinic. They are not results for any live site.
        </Notice>
      ) : null}
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs font-semibold text-ink-3">{k}</dt>
            <dd className="break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {audit.isDemo ? <span className="sr-only"><DemoBadge /></span> : null}
    </div>
  );
}

type TileState = "fail" | "review" | "clear" | "manual";

export function criterionStates(audit: Audit): Map<string, { state: TileState; count: number }> {
  const out = new Map<string, { state: TileState; count: number }>();
  const exercised = new Set(audit.criteriaExercised);
  for (const c of criteriaForProfile(audit.profile)) {
    const related = audit.findings.filter((f) => f.criteria.some((r) => r.id === c.id));
    const fails = related.filter((f) => f.kind === "violation" || f.kind === "heuristic").length;
    const state: TileState = fails ? "fail" : related.length ? "review" : exercised.has(c.id) ? "clear" : "manual";
    out.set(c.id, { state, count: related.length });
  }
  return out;
}

const TILE_TEXT: Record<TileState, string> = {
  fail: "failures found",
  review: "needs review",
  clear: "nothing found by automated checks",
  manual: "not tested automatically, needs a person",
};

/** Every success criterion in the profile, showing what automation touched. */
export function CriteriaMap({ audit }: { audit: Audit }) {
  const states = criterionStates(audit);
  const criteria = criteriaForProfile(audit.profile);
  const tally = { fail: 0, review: 0, clear: 0, manual: 0 };
  for (const s of states.values()) tally[s.state]++;
  const principles = [
    ["1", "Perceivable"],
    ["2", "Operable"],
    ["3", "Understandable"],
    ["4", "Robust"],
  ];
  return (
    <section aria-labelledby="map-heading" className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="map-heading" className="text-lg">
          {criteria.length} success criteria in {PROFILES[audit.profile].shortLabel}
        </h2>
        <p className="text-sm text-ink-2">
          Automated checks reached {tally.fail + tally.review + tally.clear} of them. {tally.manual} can only be judged by a person.
        </p>
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-2"><span aria-hidden="true" className="crit-tile !h-4 !min-w-6" data-state="fail" /> Failures found</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="crit-tile !h-4 !min-w-6" data-state="review" /> Needs review</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="crit-tile !h-4 !min-w-6" data-state="clear" /> Checked, nothing found</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="crit-tile !h-4 !min-w-6" data-state="manual" /> Needs a person</li>
      </ul>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {principles.map(([n, name]) => {
          const group = criteria.filter((c) => c.id.startsWith(`${n}.`));
          return (
            <div key={n}>
              <h3 className="mb-2 text-sm text-ink-2">
                {n}. {name}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {group.map((c) => {
                  const s = states.get(c.id)!;
                  const label = `${c.id} ${c.title}, level ${c.level}: ${TILE_TEXT[s.state]}${s.count ? `, ${s.count} finding${s.count === 1 ? "" : "s"}` : ""}`;
                  return (
                    <li key={c.id}>
                      {s.count ? (
                        <Link href={`/findings?criterion=${c.id}`} className="crit-tile hover:brightness-95" data-state={s.state} title={label} aria-label={label}>
                          {c.id}
                        </Link>
                      ) : (
                        <span className="crit-tile" data-state={s.state} title={label} role="img" aria-label={label}>
                          {c.id}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-ink-3">
        &ldquo;Checked, nothing found&rdquo; means the automated rules for that criterion ran without a failure on the tested state. It does not mean the criterion is met.
      </p>
    </section>
  );
}

/** A 1 to 21 scale with the WCAG thresholds marked, showing where a ratio sits. */
export function ContrastRuler({ ratio, required, after, foreground, background, afterColor }: { ratio?: number; required: number; after?: number; foreground?: string; background?: string; afterColor?: string }) {
  // Log scale so the thresholds that matter (3, 4.5, 7) get room.
  const pos = (r: number) => `${(Math.log(r) / Math.log(21)) * 100}%`;
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {foreground && background ? (
          <Swatch fg={foreground} bg={background} label={`Original: ${foreground} on ${background}${ratio ? `, ${formatRatio(ratio)}` : ""}`} />
        ) : null}
        {afterColor && background ? <Swatch fg={afterColor} bg={background} label={`Proposed: ${afterColor} on ${background}${after ? `, ${formatRatio(after)}` : ""}`} /> : null}
      </div>
      <div aria-hidden="true" className="relative mt-5 mb-6 h-2 rounded-full bg-sunk">
        <div className="absolute inset-y-0 left-0 rounded-full bg-critical-wash" style={{ width: pos(required) }} />
        {[3, 4.5, 7].map((t) => (
          <div key={t} className="absolute -top-1 h-4 w-px bg-ink-3" style={{ left: pos(t) }}>
            <span className="absolute top-5 -translate-x-1/2 font-mono text-[11px] text-ink-3">{t}</span>
          </div>
        ))}
        {ratio ? <Marker at={pos(ratio)} label="Now" tone="critical" /> : null}
        {after ? <Marker at={pos(after)} label="Fix" tone="resolved" /> : null}
      </div>
      <figcaption className="text-xs text-ink-3">
        Required: {required}:1{ratio ? `. Measured: ${formatRatio(ratio)}` : ""}
        {after ? `. Proposed: ${formatRatio(after)}` : ""}. Ratios are truncated, never rounded up.
      </figcaption>
    </figure>
  );
}

function Marker({ at, label, tone }: { at: string; label: string; tone: "critical" | "resolved" }) {
  return (
    <div className="absolute -top-6 -translate-x-1/2" style={{ left: at }}>
      <span className={`block rounded px-1 text-[11px] font-bold ${tone === "critical" ? "bg-critical text-surface" : "bg-resolved text-surface"}`}>{label}</span>
      <span className={`mx-auto mt-0.5 block h-4 w-0.5 ${tone === "critical" ? "bg-critical" : "bg-resolved"}`} />
    </div>
  );
}

function Swatch({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* A drawn specimen of the measured pair. It deliberately reproduces failing colours, so it is an image, not text. */}
      <svg aria-hidden="true" width="48" height="32" viewBox="0 0 48 32" className="shrink-0 rounded border border-line-control">
        <rect width="48" height="32" fill={bg} />
        <text x="24" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill={fg} fontFamily="var(--font-sans)">
          Aa
        </text>
      </svg>
      <span className="font-mono text-xs">{label}</span>
    </span>
  );
}

export function groupByRule(findings: Finding[]): { ruleId: string; title: string; items: Finding[] }[] {
  const map = new Map<string, { ruleId: string; title: string; items: Finding[] }>();
  for (const f of findings) {
    const g = map.get(f.ruleId) ?? { ruleId: f.ruleId, title: f.title, items: [] };
    g.items.push(f);
    map.set(f.ruleId, g);
  }
  return [...map.values()];
}
