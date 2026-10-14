import { NextResponse } from "next/server";
import { handle } from "@/lib/api/handle";
import { inferDialect, SourceScanSchema } from "@/lib/api/schemas";
import { scanDocument } from "@/lib/scanner/scan";
import type { ProfileId } from "@/lib/standards/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(req, {
    name: "scan-source",
    schema: SourceScanSchema,
    maxBytes: 700_000,
    rate: { limit: 20, windowMs: 60_000 },
    run: async (input, request) => {
      const dialect = input.dialect ?? inferDialect(input.fileName, input.text);
      const result = await scanDocument(
        { dialect, text: input.text, fileName: input.fileName, origin: "user-source" },
        { profile: input.profile as ProfileId, includeBestPractice: input.includeBestPractice, viewport: input.viewport, signal: request.signal },
      );
      return NextResponse.json(result);
    },
  });
}
