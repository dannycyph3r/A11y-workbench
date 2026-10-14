"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface TabDef {
  id: string;
  label: string;
  icon?: LucideIcon;
}

/** WAI-ARIA tabs with automatic activation and roving tabindex. */
export function Tabs({ tabs, value, onChange, label, children }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; children: ReactNode }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = tabs.findIndex((t) => t.id === value);

  const onKey = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line" onKeyDown={onKey}>
        {tabs.map((t, i) => {
          const selected = t.id === value;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={`-mb-px flex min-h-11 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold ${selected ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {Icon ? <Icon aria-hidden="true" size={16} /> : null}
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="pt-6">
        {children}
      </div>
    </div>
  );
}
