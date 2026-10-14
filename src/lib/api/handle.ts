import "server-only";
import type { ZodType } from "zod";
import { BusyError, clientKey, rateLimit } from "@/lib/security/limits";
import { BrowserUnavailableError } from "@/lib/scanner/browser";
import { ScanError } from "@/lib/scanner/scan";
import { GuardError } from "@/lib/security/url-guard";
import { apiError, BadJson, PayloadTooLarge, readJson, unexpected, validationError } from "./respond";

interface HandleOptions<T> {
  name: string;
  schema: ZodType<T>;
  maxBytes: number;
  rate: { limit: number; windowMs: number };
  run: (input: T, req: Request) => Promise<Response>;
}

/** Common pipeline for POST routes: size limit, JSON, rate limit, schema, error mapping. */
export async function handle<T>(req: Request, opts: HandleOptions<T>): Promise<Response> {
  const limit = rateLimit(`${opts.name}:${clientKey(req)}`, opts.rate.limit, opts.rate.windowMs);
  if (!limit.ok) {
    return apiError("rate-limited", `Too many requests. Try again in ${limit.retryAfterSec} seconds.`, 429, { "retry-after": String(limit.retryAfterSec) });
  }
  let body: unknown;
  try {
    body = await readJson(req, opts.maxBytes);
  } catch (err) {
    if (err instanceof PayloadTooLarge) return apiError("too-large", "The request is too large.", 413);
    if (err instanceof BadJson) return apiError("invalid-json", "The request body is not valid JSON.", 400);
    return unexpected(opts.name, err);
  }
  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return await opts.run(parsed.data, req);
  } catch (err) {
    if (err instanceof ScanError) return apiError(err.code, err.message, err.status);
    if (err instanceof GuardError) return apiError(err.code, err.message, 400);
    if (err instanceof BusyError) return apiError("busy", err.message, 503, { "retry-after": "30" });
    if (err instanceof BrowserUnavailableError) return apiError("browser-unavailable", err.message, 503);
    if (err instanceof DOMException && err.name === "AbortError") return apiError("cancelled", "The scan was cancelled.", 499);
    return unexpected(opts.name, err);
  }
}
