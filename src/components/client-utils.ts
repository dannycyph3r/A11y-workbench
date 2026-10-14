"use client";

import { useEffect, useState } from "react";

export interface ServerStatus {
  workbench: string;
  scanner: { available: boolean; browser?: string; error?: string; axeVersion: string };
  figma: { configured: boolean };
  ai: { configured: boolean; provider?: string };
  limits: { concurrentScans: number; urlScansPerMinute: number; sourceScansPerMinute: number };
}

let cached: Promise<ServerStatus | null> | null = null;

export function fetchStatus(): Promise<ServerStatus | null> {
  cached ??= fetch("/api/status", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<ServerStatus>) : null))
    .catch(() => null);
  return cached;
}

export function useServerStatus(): { status: ServerStatus | null; loading: boolean } {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void fetchStatus().then((s) => {
      if (!live) return;
      setStatus(s);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);
  return { status, loading };
}

export function downloadText(fileName: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface ApiErrorBody {
  error?: { code: string; message: string };
}

/** POSTs JSON and returns either the parsed body or a readable error message. */
export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, message: "Cancelled.", code: "cancelled" };
    return { ok: false, message: "The server could not be reached. Check that the app is running." };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    return { ok: false, message: e?.message ?? `The request failed (HTTP ${res.status}).`, code: e?.code };
  }
  return { ok: true, data: data as T };
}

export function slugFile(s: string): string {
  return s.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "audit";
}
