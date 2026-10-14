"use client";

import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Info,
  LoaderCircle,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { FindingKind, FixConfidence, Impact, VerificationStatus } from "@/lib/findings/types";

export function PageHeader({ title, description, actions, id = "page-title" }: { title: string; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[68ch]">
        <h1 id={id} tabIndex={-1} className="text-2xl outline-none">
          {title}
        </h1>
        {description ? <div className="mt-2 text-ink-2">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 no-print">{actions}</div> : null}
    </div>
  );
}

type Tone = "critical" | "serious" | "moderate" | "minor" | "resolved" | "review" | "accent" | "neutral";

const TONE: Record<Tone, string> = {
  critical: "bg-critical-wash text-critical border-critical",
  serious: "bg-serious-wash text-serious border-serious",
  moderate: "bg-moderate-wash text-moderate border-moderate",
  minor: "bg-minor-wash text-minor border-line-control",
  resolved: "bg-resolved-wash text-resolved border-resolved",
  review: "bg-review-wash text-review border-review",
  accent: "bg-accent-wash text-accent-ink border-accent",
  neutral: "bg-surface-2 text-ink-2 border-line-control",
};

export function Badge({ tone, icon: Icon, children, title }: { tone: Tone; icon?: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-xs font-semibold ${TONE[tone]}`}>
      {Icon ? <Icon aria-hidden="true" size={13} strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

export const IMPACT_META: Record<Impact, { tone: Tone; icon: LucideIcon; label: string }> = {
  critical: { tone: "critical", icon: OctagonAlert, label: "Critical" },
  serious: { tone: "serious", icon: TriangleAlert, label: "Serious" },
  moderate: { tone: "moderate", icon: CircleAlert, label: "Moderate" },
  minor: { tone: "minor", icon: Info, label: "Minor" },
};

export function ImpactBadge({ impact }: { impact: Impact }) {
  const m = IMPACT_META[impact];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

export const KIND_META: Record<FindingKind, { label: string; tone: Tone; help: string }> = {
  violation: { label: "Violation", tone: "neutral", help: "An automated rule failed with clear evidence." },
  heuristic: { label: "Heuristic", tone: "neutral", help: "A likely problem found from indirect evidence. Confirm it by hand." },
  "needs-review": { label: "Needs review", tone: "review", help: "The engine found something it could not decide. A person must judge it." },
  inconclusive: { label: "Inconclusive", tone: "neutral", help: "The check could not resolve its inputs, so no result is claimed." },
};

export function KindBadge({ kind }: { kind: FindingKind }) {
  const m = KIND_META[kind];
  return (
    <Badge tone={m.tone} title={m.help} icon={kind === "inconclusive" ? CircleDashed : kind === "needs-review" ? CircleHelp : undefined}>
      {m.label}
    </Badge>
  );
}

export const CONFIDENCE_META: Record<FixConfidence, { label: string; tone: Tone; help: string }> = {
  high: { label: "High-confidence suggestion", tone: "resolved", help: "Deterministic and well supported." },
  review: { label: "Review recommended", tone: "accent", help: "Context-dependent or may change the design." },
  manual: { label: "Manual assessment required", tone: "neutral", help: "Cannot be resolved from the available evidence alone." },
};

export function ConfidenceBadge({ confidence }: { confidence: FixConfidence }) {
  const m = CONFIDENCE_META[confidence];
  return (
    <Badge tone={m.tone} title={m.help}>
      {m.label}
    </Badge>
  );
}

export const VERIFY_META: Record<VerificationStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  unverified: { label: "Not verified", tone: "neutral", icon: CircleDashed },
  resolved: { label: "Resolved on rerun", tone: "resolved", icon: CircleCheck },
  "still-failing": { label: "Still failing", tone: "critical", icon: CircleAlert },
  "not-testable": { label: "Needs manual check", tone: "review", icon: CircleHelp },
};

export function VerifyBadge({ status }: { status: VerificationStatus }) {
  const m = VERIFY_META[status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="review" title="Recorded sample data, not a live scan">
      Demo data
    </Badge>
  );
}

export function Notice({ tone = "info", title, children, role }: { tone?: "info" | "warning" | "error" | "success"; title?: string; children: ReactNode; role?: "alert" | "status" }) {
  const styles = {
    info: { cls: "border-accent bg-accent-wash", icon: Info, color: "text-accent-ink" },
    warning: { cls: "border-moderate bg-moderate-wash", icon: TriangleAlert, color: "text-moderate" },
    error: { cls: "border-critical bg-critical-wash", icon: CircleAlert, color: "text-critical" },
    success: { cls: "border-resolved bg-resolved-wash", icon: CircleCheck, color: "text-resolved" },
  }[tone];
  const Icon = styles.icon;
  return (
    <div role={role} className={`flex gap-3 rounded-[var(--radius-control)] border-l-4 px-4 py-3 ${styles.cls}`}>
      <Icon aria-hidden="true" size={18} className={`mt-0.5 shrink-0 ${styles.color}`} />
      <div className="min-w-0 text-sm text-ink">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-1" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({ title, children, actions, icon: Icon }: { title: string; children?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-8">
      {Icon ? <Icon aria-hidden="true" size={28} className="text-ink-3" /> : null}
      <h2 className="text-lg">{title}</h2>
      {children ? <div className="max-w-[60ch] text-ink-2">{children}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-lg">
        {children}
      </h2>
      {aside}
    </div>
  );
}
