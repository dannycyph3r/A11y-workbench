import type { Audit, Finding, VerificationStatus } from "@/lib/findings/types";
import { PROFILES } from "@/lib/standards/profiles";
import { criteriaForProfile } from "@/lib/standards/profiles";
import { proposeFix, type RemediationSettings } from "@/lib/remediation/engine";
import type { RemediationState } from "@/lib/remediation/state";
import { WORKBENCH_VERSION } from "@/lib/version";

export const NON_CERTIFICATION =
  "This report records the results of automated and heuristic checks on the stated scope. It is not a certification of conformance with WCAG, the AODA or any other standard or law, and passing these checks does not mean the content is accessible. A full evaluation needs manual testing with assistive technology and people with disabilities.";

export interface ReportFinding {
  id: string;
  rule: string;
  title: string;
  kind: Finding["kind"];
  impact: Finding["impact"];
  category: Finding["category"];
  criteria: string[];
  bestPractice: boolean;
  selector: string;
  location?: string;
  html: string;
  evidence: string[];
  recommendation: string;
  fixConfidence: Finding["fixConfidence"];
  fixDecision: "none available" | "proposed" | "accepted" | "rejected";
  proposedFix?: string;
  verification: VerificationStatus;
  verificationNote?: string;
}

export interface Report {
  generatedAt: string;
  generator: string;
  demo: boolean;
  target: string;
  inputKind: Audit["input"]["kind"];
  auditedAt: string;
  standard: { profile: string; basis: string };
  engine: Audit["engine"];
  scope: Audit["scope"];
  summary: {
    total: number;
    byKind: Record<string, number>;
    byImpact: Record<string, number>;
    accepted: number;
    resolved: number;
    stillFailing: number;
    notTestable: number;
    introducedByPatch: number;
  };
  findings: ReportFinding[];
  manualReviewChecklist: { criterion: string; title: string; prompt: string; automatedCoverage: "partial" | "none" }[];
  warnings: string[];
  limitations: string[];
  notice: string;
}

export function auditTarget(audit: Audit): string {
  switch (audit.input.kind) {
    case "url":
      return audit.input.finalUrl;
    case "figma":
      return audit.input.fileKey ? `Figma file ${audit.input.fileKey}${audit.input.nodeIds?.length ? ` (nodes ${audit.input.nodeIds.join(", ")})` : ""}` : audit.input.fileName;
    default:
      return audit.input.fileName;
  }
}

export function buildReport(audit: Audit, rem: RemediationState | undefined, settings: RemediationSettings): Report {
  const verification = rem?.verification && !rem.verification.stale ? rem.verification : undefined;
  const byId = new Map(verification?.results.map((r) => [r.findingId, r]) ?? []);

  const findings: ReportFinding[] = audit.findings.map((f) => {
    const state = rem?.fixes[f.id];
    const fix = proposeFix(f, audit.document, state?.inputs ?? {}, settings);
    const v = byId.get(f.id);
    return {
      id: f.id,
      rule: f.ruleId,
      title: f.title,
      kind: f.kind,
      impact: f.impact,
      category: f.category,
      criteria: f.criteria.map((c) => `${c.id} ${c.title} (${c.level})`),
      bestPractice: f.isBestPractice,
      selector: f.node.selector,
      location: f.node.location ? `line ${f.node.location.line}, column ${f.node.location.column}` : undefined,
      html: f.node.html,
      evidence: f.node.evidence,
      recommendation: f.recommendation,
      fixConfidence: f.fixConfidence,
      fixDecision: !fix || (fix.edits.length === 0 && !fix.needsInput) ? "none available" : (state?.decision ?? "proposed"),
      proposedFix: fix?.summary,
      verification: v?.status ?? (state?.decision === "accepted" ? "unverified" : f.verification),
      verificationNote: v?.note,
    };
  });

  const count = <K extends string>(items: K[]) => items.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
  const exercised = new Set(audit.criteriaExercised);
  const checklist = criteriaForProfile(audit.profile).map((c) => ({
    criterion: c.id,
    title: c.title,
    prompt: c.manualPrompt,
    automatedCoverage: (exercised.has(c.id) ? "partial" : "none") as "partial" | "none",
  }));

  return {
    generatedAt: new Date().toISOString(),
    generator: `A11y Workbench ${WORKBENCH_VERSION}`,
    demo: audit.isDemo,
    target: auditTarget(audit),
    inputKind: audit.input.kind,
    auditedAt: audit.createdAt,
    standard: { profile: PROFILES[audit.profile].label, basis: PROFILES[audit.profile].basis },
    engine: audit.engine,
    scope: audit.scope,
    summary: {
      total: findings.length,
      byKind: count(findings.map((f) => f.kind)),
      byImpact: count(findings.map((f) => f.impact)),
      accepted: findings.filter((f) => f.fixDecision === "accepted").length,
      resolved: findings.filter((f) => f.verification === "resolved").length,
      stillFailing: findings.filter((f) => f.verification === "still-failing").length,
      notTestable: findings.filter((f) => f.verification === "not-testable").length,
      introducedByPatch: verification?.introduced.length ?? 0,
    },
    findings,
    manualReviewChecklist: checklist,
    warnings: audit.warnings,
    limitations: audit.limitations,
    notice: NON_CERTIFICATION,
  };
}

/** RFC 4180 CSV. Cells that start with a formula character are prefixed to stop spreadsheet injection. */
export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report: Report): string {
  const header = ["id", "rule", "title", "kind", "impact", "category", "criteria", "best_practice", "selector", "location", "evidence", "recommendation", "fix_confidence", "fix_decision", "proposed_fix", "verification", "verification_note"];
  const rows = report.findings.map((f) =>
    [f.id, f.rule, f.title, f.kind, f.impact, f.category, f.criteria, f.bestPractice ? "yes" : "no", f.selector, f.location, f.evidence, f.recommendation, f.fixConfidence, f.fixDecision, f.proposedFix, f.verification, f.verificationNote].map(csvCell).join(","),
  );
  const preamble = [
    `# A11y Workbench report${report.demo ? " (DEMO DATA, not a live scan)" : ""}`,
    `# Target: ${report.target}`,
    `# Standard: ${report.standard.profile}`,
    `# Engine: ${report.engine.name} ${report.engine.version}${report.engine.browser ? `, Chromium ${report.engine.browser}` : ""}`,
    `# ${report.notice}`,
  ].map((l) => csvCell(l));
  return [...preamble, header.join(","), ...rows].join("\r\n") + "\r\n";
}
