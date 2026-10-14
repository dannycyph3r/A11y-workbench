import type { Finding, RemediationDocument } from "@/lib/findings/types";
import { applyEdits, dedupeEdits, editsConflict, type TextEdit } from "./edits";
import { FIXERS, type ProposedFix } from "./fixers";

export type FixDecision = "proposed" | "accepted" | "rejected";

export interface FixState {
  decision: FixDecision;
  inputs: Record<string, string>;
}

export interface RemediationSettings {
  defaultLang: string;
}

/** Produces the proposed fix for a finding, or null when only guidance is possible. */
export function proposeFix(
  finding: Finding,
  doc: RemediationDocument | undefined,
  inputs: Record<string, string>,
  settings: RemediationSettings,
): ProposedFix | null {
  if (!doc) return null;
  const fixer = FIXERS[finding.ruleId];
  if (!fixer) return null;
  try {
    const result = fixer({ doc, finding, inputs, settings });
    return result ? { ...result, findingId: finding.id, ruleId: finding.ruleId } : null;
  } catch {
    // A fixer that cannot cope with unusual markup proposes nothing rather than something wrong.
    return null;
  }
}

export interface ComposedPatch {
  text: string;
  edits: TextEdit[];
  applied: string[]; // finding ids whose edits are in `text`
  conflicts: { findingId: string; withFindingId: string }[];
}

/**
 * Applies accepted fixes in order of acceptance. A fix whose edits overlap
 * an earlier accepted fix is reported as a conflict and left out; nothing
 * is dropped silently.
 */
export function composeAccepted(doc: RemediationDocument, accepted: ProposedFix[]): ComposedPatch {
  const edits: TextEdit[] = [];
  const owners: { edit: TextEdit; findingId: string }[] = [];
  const applied: string[] = [];
  const conflicts: ComposedPatch["conflicts"] = [];
  for (const fix of accepted) {
    if (fix.needsInput || fix.edits.length === 0) continue;
    const clash = fix.edits.flatMap((e) => owners.filter((o) => editsConflict(o.edit, e))).at(0);
    if (clash) {
      conflicts.push({ findingId: fix.findingId, withFindingId: clash.findingId });
      continue;
    }
    for (const e of fix.edits) {
      edits.push(e);
      owners.push({ edit: e, findingId: fix.findingId });
    }
    applied.push(fix.findingId);
  }
  const unique = dedupeEdits(edits);
  return { text: applyEdits(doc.text, unique), edits: unique, applied, conflicts };
}

/** Applies a single fix in isolation, for the per-finding preview. */
export function previewFix(doc: RemediationDocument, fix: ProposedFix): string {
  return applyEdits(doc.text, fix.edits);
}
