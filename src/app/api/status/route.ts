import { NextResponse } from "next/server";
import { axeVersion, browserStatus } from "@/lib/scanner/browser";
import { figmaConfigured } from "@/lib/figma/client";
import { getExplanationProvider } from "@/lib/ai/provider";
import { WORKBENCH_VERSION } from "@/lib/version";
import { MAX_CONCURRENT_JOBS } from "@/lib/security/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const browser = await browserStatus();
  const ai = getExplanationProvider();
  return NextResponse.json({
    workbench: WORKBENCH_VERSION,
    scanner: { available: browser.available, browser: browser.version, error: browser.available ? undefined : "The scanning browser is not installed or could not start.", axeVersion: axeVersion() },
    figma: { configured: figmaConfigured() },
    ai: { configured: Boolean(ai), provider: ai?.id },
    limits: { concurrentScans: MAX_CONCURRENT_JOBS, urlScansPerMinute: 6, sourceScansPerMinute: 20 },
  });
}
