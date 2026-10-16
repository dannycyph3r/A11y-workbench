"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, GitCompareArrows, ListChecks, Menu, PanelsTopLeft, ScanSearch, Settings2, X } from "lucide-react";
import { useStore } from "./store";
import { auditTarget } from "@/lib/report/report";
import { PROFILES } from "@/lib/standards/profiles";
import { PRODUCT_NAME } from "@/lib/version";

const NAV = [
  { href: "/", label: "Overview", icon: PanelsTopLeft },
  { href: "/audit/new", label: "New audit", icon: ScanSearch },
  { href: "/findings", label: "Findings", icon: ListChecks },
  { href: "/workspace", label: "Remediation workspace", icon: GitCompareArrows },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const AnnounceCtx = createContext<(message: string) => void>(() => undefined);

/** Polite announcements for status changes that have no visible focus move. */
export function useAnnounce() {
  return useContext(AnnounceCtx);
}

function Mark() {
  // Two halves of a square: the contrast pair every audit starts with.
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" className="shrink-0">
      <rect x="1" y="1" width="24" height="24" rx="5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M13 2h7a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-7z" fill="var(--ink)" />
      <circle cx="13" cy="13" r="4.5" fill="var(--accent)" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { current, ready } = useStore();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const first = useRef(true);

  const announce = useCallback((m: string) => {
    setMessage("");
    // A fresh node content after a tick makes repeated messages announce again.
    setTimeout(() => setMessage(m), 60);
  }, []);

  useEffect(() => {
    // On client-side navigation, move focus to the new page's heading. Not on first load,
    // so the skip link stays the first tab stop.
    if (first.current) {
      first.current = false;
      return;
    }
    setOpen(false);
    const h = document.querySelector<HTMLElement>("main h1");
    h?.focus({ preventScroll: false });
  }, [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <ul className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className="flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-accent-wash aria-[current=page]:text-accent-ink"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={2} />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <AnnounceCtx.Provider value={announce}>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
        <div className="no-print sticky top-0 z-20 lg:static lg:border-r lg:border-line lg:bg-surface">
        <header className="border-b border-line bg-surface lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:border-b-0">
          <div className="flex h-14 items-center justify-between gap-2 px-4 lg:h-16">
            <Link href="/" className="flex items-center gap-2.5 rounded font-bold">
              <Mark />
              <span>{PRODUCT_NAME}</span>
            </Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm lg:hidden"
              aria-expanded={open}
              aria-controls="primary-nav"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X aria-hidden="true" size={16} /> : <Menu aria-hidden="true" size={16} />}
              Menu
            </button>
          </div>
          <nav id="primary-nav" aria-label="Primary" className={`${open ? "block" : "hidden"} border-t border-line px-3 py-3 lg:block lg:border-t-0`}>
            {nav}
          </nav>
          <div className="hidden px-4 pt-4 lg:block">
            <p className="text-xs font-semibold text-ink-3">Current audit</p>
            {ready && current ? (
              <div className="mt-1.5 text-sm">
                <p className="break-all font-semibold text-ink">{auditTarget(current)}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {PROFILES[current.profile].shortLabel}
                  {current.isDemo ? ", demo data" : ""}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-ink-3">None yet</p>
            )}
          </div>
        </header>
        </div>
        <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-9">
          <div className="mx-auto max-w-[1240px]">{children}</div>
        </main>
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
        {message}
      </div>
    </AnnounceCtx.Provider>
  );
}
