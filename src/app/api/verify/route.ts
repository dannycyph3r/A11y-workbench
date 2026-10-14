import { NextResponse } from "next/server";
import { handle } from "@/lib/api/handle";
import { VerifySchema } from "@/lib/api/schemas";
import { verifyPatch } from "@/lib/remediation/verify";
import { applyEdits } from "@/lib/remediation/edits";
import type { ProfileId } from "@/lib/standards/profiles";
import { apiError } from "@/lib/api/respond";
import type { Finding } from "@/lib/findings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(req, {
    name: "verify",
    schema: VerifySchema,
    maxBytes: 5_000_000,
    rate: { limit: 15, windowMs: 60_000 },
    run: async (input, request) => {
      // The server recomputes the patched text from the edits rather than trusting the client copy.
      let patched: string;
      try {
        patched = applyEdits(input.document.text, input.edits);
      } catch {
        return apiError("conflict", "The accepted changes overlap. Reject one of the conflicting fixes and try again.", 409);
      }
      if (patched !== input.patched) return apiError("mismatch", "The patched text does not match the accepted changes. Reload the workspace and try again.", 409);
      const result = await verifyPatch({
        doc: input.document,
        patched,
        edits: input.edits,
        profile: input.profile as ProfileId,
        includeBestPractice: input.includeBestPractice,
        findings: input.findings as Pick<Finding, "id" | "ruleId" | "node">[],
        signal: request.signal,
      });
      return NextResponse.json(result);
    },
  });
}
