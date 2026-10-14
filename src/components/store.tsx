"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Audit } from "@/lib/findings/types";
import type { ProfileId } from "@/lib/standards/profiles";
import { emptyRemediation, remediationReducer, type RemediationAction, type RemediationState } from "@/lib/remediation/state";
import demoAudit from "@/lib/demo/demo-audit.json";

/**
 * Client-side workspace state. Audits and remediation decisions live in
 * sessionStorage, so they disappear when the tab closes; nothing is
 * stored on the server. Settings (no content) persist in localStorage.
 */

export interface Settings {
  profile: ProfileId;
  includeBestPractice: boolean;
  viewport: "desktop" | "tablet" | "mobile";
  defaultLang: string;
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = { profile: "wcag22aa", includeBestPractice: true, viewport: "desktop", defaultLang: "en", theme: "system" };

interface StoreValue {
  ready: boolean;
  audits: Audit[];
  current: Audit | undefined;
  setCurrent: (id: string) => void;
  addAudit: (a: Audit) => void;
  removeAudit: (id: string) => void;
  loadDemo: () => Audit;
  remediation: (auditId: string) => RemediationState;
  dispatch: (auditId: string, action: RemediationAction) => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  clearAll: () => void;
  persistWarning: string | null;
}

const Ctx = createContext<StoreValue | null>(null);

const SESSION_KEY = "awb.session.v1";
const SETTINGS_KEY = "awb.settings.v1";

interface Persisted {
  audits: Audit[];
  currentId?: string;
  remediation: Record<string, RemediationState>;
}

function safeRead<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [rem, setRem] = useState<Record<string, RemediationState>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const p = safeRead<Persisted>(() => sessionStorage, SESSION_KEY);
    const s = safeRead<Partial<Settings>>(() => localStorage, SETTINGS_KEY);
    // Hydrate from browser storage once, after mount, so server and client markup match.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (p) {
      setAudits(p.audits ?? []);
      setCurrentId(p.currentId);
      setRem(p.remediation ?? {});
    }
    if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
    loaded.current = true;
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ audits, currentId, remediation: rem } satisfies Persisted));
      // Reflects the result of writing to an external store (sessionStorage) back into the UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersistWarning(null);
    } catch {
      setPersistWarning("This session is too large to keep across a page reload. Export a report before you leave the page.");
    }
  }, [audits, currentId, rem]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* settings are a convenience; ignore storage failures */
    }
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings]);

  const addAudit = useCallback((a: Audit) => {
    setAudits((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 12));
    setCurrentId(a.id);
  }, []);

  const loadDemo = useCallback(() => {
    const a = structuredClone(demoAudit) as unknown as Audit;
    addAudit(a);
    return a;
  }, [addAudit]);

  const removeAudit = useCallback((id: string) => {
    setAudits((list) => list.filter((a) => a.id !== id));
    setRem((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== id)));
    setCurrentId((cur) => (cur === id ? undefined : cur));
  }, []);

  const dispatch = useCallback((auditId: string, action: RemediationAction) => {
    setRem((all) => ({ ...all, [auditId]: remediationReducer(all[auditId] ?? emptyRemediation(), action) }));
  }, []);

  const value = useMemo<StoreValue>(() => {
    const current = audits.find((a) => a.id === currentId) ?? audits[0];
    return {
      ready,
      audits,
      current,
      setCurrent: setCurrentId,
      addAudit,
      removeAudit,
      loadDemo,
      remediation: (id) => rem[id] ?? emptyRemediation(),
      dispatch,
      settings,
      updateSettings: (patch) => setSettings((s) => ({ ...s, ...patch })),
      clearAll: () => {
        setAudits([]);
        setRem({});
        setCurrentId(undefined);
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch {
          /* ignore */
        }
      },
      persistWarning,
    };
  }, [ready, audits, currentId, rem, settings, addAudit, removeAudit, loadDemo, dispatch, persistWarning]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
