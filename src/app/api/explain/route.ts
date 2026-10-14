import { NextResponse } from "next/server";
import { handle } from "@/lib/api/handle";
import { ExplainSchema } from "@/lib/api/schemas";
import { getExplanationProvider } from "@/lib/ai/provider";
import { apiError } from "@/lib/api/respond";
import type { Finding } from "@/lib/findings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(req, {
    name: "explain",
    schema: ExplainSchema,
    maxBytes: 20_000,
    rate: { limit: 10, windowMs: 60_000 },
    run: async (input, request) => {
      const provider = getExplanationProvider();
      if (!provider) return apiError("ai-disabled", "AI explanations are not configured on this server.", 501);
      try {
        const text = await provider.explain(input.finding as unknown as Finding, request.signal);
        return NextResponse.json({ text, provider: provider.id });
      } catch {
        return apiError("ai-failed", "The AI provider did not return an explanation. The finding's own guidance still applies.", 502);
      }
    },
  });
}
