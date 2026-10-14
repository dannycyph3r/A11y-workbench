import { NextResponse } from "next/server";
import { handle } from "@/lib/api/handle";
import { FigmaImportSchema } from "@/lib/api/schemas";
import { parseFigmaUrl } from "@/lib/figma/url";
import { FigmaApiError, fetchFigma } from "@/lib/figma/client";
import { analyzeFigma, FigmaFormatError } from "@/lib/figma/analyze";
import { apiError } from "@/lib/api/respond";
import type { ProfileId } from "@/lib/standards/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(req, {
    name: "figma-import",
    schema: FigmaImportSchema,
    maxBytes: 4_000,
    rate: { limit: 10, windowMs: 60_000 },
    run: async (input, request) => {
      const ref = parseFigmaUrl(input.url);
      if (!ref) return apiError("invalid-figma-url", "That is not a Figma file URL. Copy the link from Figma's Share menu.", 400);
      try {
        const json = await fetchFigma(ref, request.signal);
        const audit = analyzeFigma(json, input.profile as ProfileId, { fileName: (json as { name?: string }).name ?? ref.fileKey, via: "api", fileKey: ref.fileKey, nodeIds: ref.nodeIds });
        return NextResponse.json({ audit });
      } catch (err) {
        if (err instanceof FigmaApiError) return apiError("figma", err.message, err.status);
        if (err instanceof FigmaFormatError) return apiError("figma-format", err.message, 422);
        throw err;
      }
    },
  });
}
