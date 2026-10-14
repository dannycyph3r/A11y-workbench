import { NextResponse } from "next/server";
import { handle } from "@/lib/api/handle";
import { UrlScanSchema } from "@/lib/api/schemas";
import { scanDocument, scanUrl } from "@/lib/scanner/scan";
import { attachLocations } from "@/lib/findings/normalize";
import type { ProfileId } from "@/lib/standards/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(req, {
    name: "scan-url",
    schema: UrlScanSchema,
    maxBytes: 8_000,
    rate: { limit: 6, windowMs: 60_000 },
    run: async (input, request) => {
      const opts = { profile: input.profile as ProfileId, includeBestPractice: input.includeBestPractice, viewport: input.viewport, signal: request.signal };
      const audit = await scanUrl(input.url, opts);
      // Rescan the snapshot offline so findings can be traced to exact positions for remediation.
      if (audit.document) {
        try {
          const snap = await scanDocument(audit.document, opts);
          audit.findings = attachLocations(audit.findings, snap.audit.findings);
          const located = audit.findings.filter((f) => f.node.location).length;
          audit.scope.notes.push(`${located} of ${audit.findings.length} findings were traced to the page snapshot for remediation.`);
        } catch {
          audit.warnings.push("The page snapshot could not be re-rendered offline, so fixes cannot be generated for this audit.");
          audit.document = undefined;
        }
      }
      return NextResponse.json({ audit });
    },
  });
}
