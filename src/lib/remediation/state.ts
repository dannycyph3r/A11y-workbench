import type { FixState } from "./engine";
import type { VerificationResult } from "./verify-types";

/**
 * Remediation workspace state for one audit. Decisions only ever change
 * this local record; nothing is written to a remote site or repository.
 */
export interface RemediationState {
  fixes: Record<string, FixState>;
  /** Finding ids in the order their fixes were accepted. Earlier wins on conflict. */
  acceptedOrder: string[];
  verification?: VerificationResult & { stale: boolean };
}

export const emptyRemediation = (): RemediationState => ({ fixes: {}, acceptedOrder: [] });

export type RemediationAction =
  | { type: "accept"; findingId: string }
  | { type: "reject"; findingId: string }
  | { type: "reset"; findingId: string }
  | { type: "input"; findingId: string; key: string; value: string }
  | { type: "verified"; result: VerificationResult }
  | { type: "resetAll" };

const current = (s: RemediationState, id: string): FixState => s.fixes[id] ?? { decision: "proposed", inputs: {} };

const markStale = (v: RemediationState["verification"]) => (v ? { ...v, stale: true } : v);

export function remediationReducer(state: RemediationState, action: RemediationAction): RemediationState {
  switch (action.type) {
    case "accept": {
      const fix = current(state, action.findingId);
      if (fix.decision === "accepted") return state;
      return {
        fixes: { ...state.fixes, [action.findingId]: { ...fix, decision: "accepted" } },
        acceptedOrder: [...state.acceptedOrder.filter((id) => id !== action.findingId), action.findingId],
        verification: markStale(state.verification),
      };
    }
    case "reject":
    case "reset": {
      const fix = current(state, action.findingId);
      const decision = action.type === "reject" ? "rejected" : "proposed";
      const wasAccepted = fix.decision === "accepted";
      return {
        fixes: { ...state.fixes, [action.findingId]: { decision, inputs: action.type === "reset" ? {} : fix.inputs } },
        acceptedOrder: state.acceptedOrder.filter((id) => id !== action.findingId),
        verification: wasAccepted ? markStale(state.verification) : state.verification,
      };
    }
    case "input": {
      const fix = current(state, action.findingId);
      return {
        ...state,
        fixes: { ...state.fixes, [action.findingId]: { ...fix, inputs: { ...fix.inputs, [action.key]: action.value } } },
        verification: fix.decision === "accepted" ? markStale(state.verification) : state.verification,
      };
    }
    case "verified":
      return { ...state, verification: { ...action.result, stale: false } };
    case "resetAll":
      return emptyRemediation();
  }
}
