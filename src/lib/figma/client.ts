import "server-only";
import type { FigmaRef } from "./url";

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const MAX_BYTES = 25 * 1024 * 1024;

export function figmaConfigured(): boolean {
  return Boolean(process.env.FIGMA_ACCESS_TOKEN);
}

/**
 * Fetches design JSON from the official Figma REST API. The token is read
 * on the server and never returned to the client.
 */
export async function fetchFigma(ref: FigmaRef, signal?: AbortSignal): Promise<unknown> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new FigmaApiError("Live Figma import is not configured on this server. Set FIGMA_ACCESS_TOKEN, or upload a JSON export instead.", 501);
  const base = `https://api.figma.com/v1/files/${encodeURIComponent(ref.fileKey)}`;
  const url = ref.nodeIds.length ? `${base}/nodes?ids=${encodeURIComponent(ref.nodeIds.join(","))}` : `${base}?depth=6`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Figma-Token": token },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new FigmaApiError("Figma could not be reached. Try again, or upload a JSON export.", 502);
  }
  if (res.status === 403) throw new FigmaApiError("Figma refused access. Check the token has read access to this file.", 403);
  if (res.status === 404) throw new FigmaApiError("Figma could not find that file or frame.", 404);
  if (res.status === 429) throw new FigmaApiError("Figma's rate limit was reached. Wait a minute and try again.", 429);
  if (!res.ok) throw new FigmaApiError(`Figma returned an error (HTTP ${res.status}).`, 502);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new FigmaApiError("That file is larger than 25 MB. Import a single frame with ?node-id= in the URL.", 413);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FigmaApiError("That file is larger than 25 MB. Import a single frame with ?node-id= in the URL.", 413);
  return JSON.parse(text) as unknown;
}
