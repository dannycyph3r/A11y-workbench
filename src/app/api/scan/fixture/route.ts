import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { handle } from "@/lib/api/handle";
import { ScanOptionsSchema } from "@/lib/api/schemas";
import { scanDocument } from "@/lib/scanner/scan";
import type { ProfileId } from "@/lib/standards/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIXTURES = { "known-bad": "known-bad.html" } as const;
const Schema = ScanOptionsSchema.extend({ fixture: z.enum(["known-bad"]).default("known-bad") });

/** Scans the bundled, deliberately flawed test page with the real engine. */
export async function POST(req: Request) {
  return handle(req, {
    name: "scan-fixture",
    schema: Schema,
    maxBytes: 2_000,
    rate: { limit: 20, windowMs: 60_000 },
    run: async (input, request) => {
      const fileName = FIXTURES[input.fixture];
      const text = await readFile(path.join(process.cwd(), "fixtures", fileName), "utf8");
      const result = await scanDocument(
        { dialect: "html", text, fileName, origin: "fixture" },
        { profile: input.profile as ProfileId, includeBestPractice: input.includeBestPractice, viewport: input.viewport, signal: request.signal },
      );
      return NextResponse.json(result);
    },
  });
}
