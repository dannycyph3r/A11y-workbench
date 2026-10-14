import "server-only";
import type { Finding, RemediationDocument } from "@/lib/findings/types";
import type { ProfileId } from "@/lib/standards/profiles";
import { scanDocument } from "@/lib/scanner/scan";
import { syntaxDiagnostics } from "@/lib/source/jsx-render";
import { scanHtml } from "@/lib/source/tags";
import { parseCss } from "@/lib/source/css";
import { mapOffset, type TextEdit } from "./edits";
import type { PatchValidation, VerificationItem, VerificationResult } from "./verify-types";

export type { PatchValidation, VerificationResult } from "./verify-types";

/** Structural checks run before a patched document is offered or rescanned. */
export function validatePatched(doc: RemediationDocument, patched: string): PatchValidation {
  const errors: string[] = [];
  if (doc.dialect === "html") {
    const before = scanHtml(doc.text);
    const after = scanHtml(patched);
    const lost = before.starts.length - after.starts.length;
    if (lost > 0) errors.push(`The patch removed ${lost} element start tag${lost === 1 ? "" : "s"}; a tag may have been broken.`);
    const unclosed = (patched.match(/<[a-zA-Z][^<>]*$/) ?? []).length;
    if (unclosed) errors.push("The patched document ends inside an unterminated tag.");
  } else if (doc.dialect === "jsx") {
    const was = syntaxDiagnostics(doc.text, doc.fileName).length;
    const now = syntaxDiagnostics(patched, doc.fileName);
    if (now.length > was) errors.push(`The patch introduced a syntax error. ${now[0] ?? ""}`.trim());
  } else {
    const opens = (patched.match(/\{/g) ?? []).length;
    const closes = (patched.match(/\}/g) ?? []).length;
    if (opens !== closes) errors.push("Braces are unbalanced in the patched stylesheet.");
    if (parseCss(patched).length < parseCss(doc.text).length) errors.push("The patched stylesheet has fewer rules than the original.");
  }
  return { ok: errors.length === 0, errors };
}

const key = (ruleId: string, start: number) => `${ruleId}@${start}`;

/**
 * Rescans the original and the patched document under identical
 * sandbox conditions and compares findings rule by rule and element by
 * element. Only what the rerun can observe is marked resolved.
 */
export async function verifyPatch(args: {
  doc: RemediationDocument;
  patched: string;
  edits: TextEdit[];
  profile: ProfileId;
  includeBestPractice: boolean;
  findings: Pick<Finding, "id" | "ruleId" | "node">[];
  signal?: AbortSignal;
}): Promise<VerificationResult> {
  const validation = validatePatched(args.doc, args.patched);
  const ranAt = new Date().toISOString();
  if (!validation.ok) {
    return {
      validation,
      results: args.findings.map((f) => ({ findingId: f.id, status: "unverified", note: "Not rescanned because the patch failed validation." })),
      introduced: [],
      beforeCount: 0,
      afterCount: 0,
      engine: { version: "" },
      ranAt,
    };
  }
  const opts = { profile: args.profile, includeBestPractice: args.includeBestPractice, signal: args.signal };
  const before = await scanDocument({ ...args.doc }, opts);
  const after = await scanDocument({ ...args.doc, text: args.patched }, opts);

  const beforeByKey = new Map<string, Finding>();
  for (const f of before.audit.findings) if (f.node.location) beforeByKey.set(key(f.ruleId, f.node.location.start), f);
  const afterKeys = new Set(after.audit.findings.filter((f) => f.node.location).map((f) => key(f.ruleId, f.node.location!.start)));
  const afterRuleSelectors = new Set(after.audit.findings.map((f) => `${f.ruleId}|${f.node.selector}`));

  const results: VerificationItem[] = args.findings.map((f) => {
    const loc = f.node.location;
    if (!loc) {
      // Page-wide findings (for example a stylesheet rule) are matched by rule and selector.
      const present = before.audit.findings.some((b) => b.ruleId === f.ruleId && b.node.selector === f.node.selector);
      if (!present) return { findingId: f.id, status: "not-testable", note: "The offline rerun could not reproduce this finding, so it cannot confirm a fix." };
      return afterRuleSelectors.has(`${f.ruleId}|${f.node.selector}`)
        ? { findingId: f.id, status: "still-failing", note: "The rerun still reports this rule for the same selector." }
        : { findingId: f.id, status: "resolved", note: "The rerun no longer reports this rule for the same selector." };
    }
    if (!beforeByKey.has(key(f.ruleId, loc.start))) {
      return { findingId: f.id, status: "not-testable", note: "The offline rerun could not reproduce this finding (it may depend on scripts, images or live data)." };
    }
    const mapped = mapOffset(loc.start, args.edits);
    return afterKeys.has(key(f.ruleId, mapped))
      ? { findingId: f.id, status: "still-failing", note: "The rerun still reports this rule on the same element." }
      : { findingId: f.id, status: "resolved", note: "The rerun no longer reports this rule on the same element." };
  });

  const expected = new Set(before.audit.findings.filter((f) => f.node.location).map((f) => key(f.ruleId, mapOffset(f.node.location!.start, args.edits))));
  const beforeRuleSelectors = new Set(before.audit.findings.map((f) => `${f.ruleId}|${f.node.selector}`));
  const introduced = after.audit.findings.filter((f) =>
    f.node.location ? !expected.has(key(f.ruleId, f.node.location.start)) : !beforeRuleSelectors.has(`${f.ruleId}|${f.node.selector}`),
  );

  return {
    validation,
    results,
    introduced,
    beforeCount: before.audit.findings.length,
    afterCount: after.audit.findings.length,
    engine: { version: after.audit.engine.version, browser: after.audit.engine.browser },
    ranAt,
  };
}
