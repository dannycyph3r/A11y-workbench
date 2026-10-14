/**
 * In-memory rate limiting and a concurrency gate for browser work. These
 * protect a single server process. A multi-instance deployment should
 * move both to shared storage (see README, deployment notes).
 */

type Bucket = { hits: number[] };
const store: Map<string, Bucket> = ((globalThis as Record<string, unknown>).__awbRate as Map<string, Bucket>) ?? new Map();
(globalThis as Record<string, unknown>).__awbRate = store;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - bucket.hits[0]!)) / 1000);
    store.set(key, bucket);
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  return { ok: true, retryAfterSec: 0 };
}

export class BusyError extends Error {}

interface Gate {
  active: number;
  queue: (() => void)[];
}
const gate: Gate = ((globalThis as Record<string, unknown>).__awbGate as Gate) ?? { active: 0, queue: [] };
(globalThis as Record<string, unknown>).__awbGate = gate;

export const MAX_CONCURRENT_JOBS = 2;
export const MAX_QUEUED_JOBS = 4;

/** Runs `job` when a slot is free. Rejects immediately if the queue is full. */
export async function withBrowserSlot<T>(job: () => Promise<T>): Promise<T> {
  if (gate.active >= MAX_CONCURRENT_JOBS) {
    if (gate.queue.length >= MAX_QUEUED_JOBS) throw new BusyError("The scanner is busy. Try again in a minute.");
    await new Promise<void>((resolve) => gate.queue.push(resolve));
  }
  gate.active++;
  try {
    return await job();
  } finally {
    gate.active--;
    gate.queue.shift()?.();
  }
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}
