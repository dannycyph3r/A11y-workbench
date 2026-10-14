import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export function validationError(err: ZodError) {
  const first = err.issues[0];
  return apiError("invalid-input", first?.message ?? "The request was not valid.", 400);
}

/** Logs a short server-side line and returns a generic message. Never leaks stack traces. */
export function unexpected(where: string, err: unknown) {
  console.error(`[a11y-workbench] ${where}:`, err instanceof Error ? (process.env.AWB_DEBUG ? err.stack : err.message) : err);
  return apiError("internal", "Something went wrong on the server. Try again; if it repeats, check the server log.", 500);
}

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new PayloadTooLarge();
  const text = await req.text();
  if (text.length > maxBytes) throw new PayloadTooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new BadJson();
  }
}

export class PayloadTooLarge extends Error {}
export class BadJson extends Error {}
