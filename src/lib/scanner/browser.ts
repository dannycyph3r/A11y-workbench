import "server-only";
import { chromium, type Browser } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * One shared headless Chromium per server process. Every scan gets its
 * own fresh browser context (separate cookies, storage and proxy), which
 * is closed when the scan ends.
 */

interface BrowserHolder {
  browser?: Browser;
  launching?: Promise<Browser>;
  idleTimer?: ReturnType<typeof setTimeout>;
  axeSource?: string;
}
const holder: BrowserHolder = ((globalThis as Record<string, unknown>).__awbBrowser as BrowserHolder) ?? {};
(globalThis as Record<string, unknown>).__awbBrowser = holder;

export class BrowserUnavailableError extends Error {}

export async function getBrowser(): Promise<Browser> {
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  if (holder.browser?.isConnected()) return holder.browser;
  if (!holder.launching) {
    holder.launching = chromium
      .launch({
        executablePath: process.env.A11Y_CHROMIUM_PATH || undefined,
        timeout: 30_000,
        args: ["--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run", "--disable-sync"],
      })
      .then((b) => {
        holder.browser = b;
        return b;
      })
      .catch((err: unknown) => {
        throw new BrowserUnavailableError(
          `The scanning browser could not start. Run "npx playwright install chromium" or set A11Y_CHROMIUM_PATH. (${err instanceof Error ? err.message.split("\n")[0] : "unknown error"})`,
        );
      })
      .finally(() => {
        holder.launching = undefined;
      });
  }
  return holder.launching;
}

/** Closes the browser after a quiet period so an idle server holds no Chromium. */
export function scheduleIdleClose(ms = 120_000) {
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  holder.idleTimer = setTimeout(() => {
    void holder.browser?.close().catch(() => undefined);
    holder.browser = undefined;
  }, ms);
  holder.idleTimer.unref?.();
}

/**
 * Resolves a file inside an installed package with Node's own resolver.
 * The bundler rewrites static require calls, so the resolver is obtained
 * at runtime; the node_modules path is a fallback for older Node versions.
 */
function resolvePackageFile(spec: string): string {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod = getBuiltin?.("node:module") as { createRequire: typeof createRequire } | undefined;
  if (mod) return mod.createRequire(path.join(process.cwd(), "noop.js")).resolve(spec);
  return path.join(process.cwd(), "node_modules", spec);
}

export function axeSource(): string {
  holder.axeSource ??= readFileSync(resolvePackageFile("axe-core/axe.min.js"), "utf8");
  return holder.axeSource;
}

export function axeVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("axe-core/package.json") as { version: string }).version;
}

export async function browserStatus(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const b = await getBrowser();
    scheduleIdleClose();
    return { available: true, version: b.version() };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}
