"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, CircleAlert, Trash2 } from "lucide-react";
import { useStore, type Settings } from "@/components/store";
import { useAnnounce } from "@/components/shell";
import { PageHeader, Spinner } from "@/components/ui";
import { useServerStatus } from "@/components/client-utils";
import { PROFILES, PROFILE_IDS } from "@/lib/standards/profiles";

export function SettingsView() {
  const { settings, updateSettings, clearAll, audits } = useStore();
  const { status, loading } = useServerStatus();
  const announce = useAnnounce();
  const [confirming, setConfirming] = useState(false);
  const [lang, setLang] = useState(settings.defaultLang);
  const langValid = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang);

  const save = (patch: Partial<Settings>, message = "Setting saved.") => {
    updateSettings(patch);
    announce(message);
  };

  return (
    <>
      <PageHeader title="Settings" description="Defaults for new audits and fixes, the status of optional integrations, and the data this browser holds." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="defaults-h" className="panel flex flex-col gap-5 p-5 sm:p-6">
          <h2 id="defaults-h" className="text-lg">Audit defaults</h2>
          <fieldset>
            <legend className="field-label">Standard</legend>
            <div className="flex flex-col gap-2">
              {PROFILE_IDS.map((id) => (
                <label key={id} className="flex items-start gap-2.5 text-sm">
                  <input type="radio" name="default-profile" className="mt-1 size-4 accent-[var(--accent)]" checked={settings.profile === id} onChange={() => save({ profile: id })} />
                  <span><span className="font-semibold">{PROFILES[id].label}</span><span className="block text-xs text-ink-3">{PROFILES[id].description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="default-viewport" className="field-label">Viewport</label>
            <select id="default-viewport" className="input" value={settings.viewport} onChange={(e) => save({ viewport: e.target.value as Settings["viewport"] })}>
              <option value="desktop">Desktop, 1280 by 800</option>
              <option value="tablet">Tablet, 820 by 1180</option>
              <option value="mobile">Mobile, 390 by 844</option>
            </select>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={settings.includeBestPractice} onChange={(e) => save({ includeBestPractice: e.target.checked })} />
            Include best-practice checks
          </label>
          <div>
            <label htmlFor="default-lang" className="field-label">Language for lang fixes</label>
            <div className="flex gap-2">
              <input id="default-lang" className="input max-w-[12rem]" value={lang} onChange={(e) => setLang(e.target.value)} aria-invalid={langValid ? undefined : true} aria-describedby="default-lang-hint" />
              <button type="button" className="btn btn-secondary" disabled={!langValid || lang === settings.defaultLang} onClick={() => save({ defaultLang: lang }, `Default language set to ${lang}.`)}>Save</button>
            </div>
            <p id="default-lang-hint" className={langValid ? "field-hint" : "field-error"}>{langValid ? "A BCP 47 tag such as en, fr or en-CA. Proposed lang fixes start from this value and you confirm each one." : "Use a language tag such as en, fr or en-CA."}</p>
          </div>
          <fieldset>
            <legend className="field-label">Theme</legend>
            <div className="flex gap-4 text-sm">
              {(["system", "light", "dark"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input type="radio" name="theme" className="accent-[var(--accent)]" checked={settings.theme === t} onChange={() => save({ theme: t }, `Theme set to ${t}.`)} />
                  {{ system: "Match system", light: "Light", dark: "Dark" }[t]}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="integrations-h" className="panel p-5 sm:p-6">
            <h2 id="integrations-h" className="text-lg">Integrations</h2>
            {loading ? (
              <div className="mt-3" role="status"><Spinner label="Checking the server" /></div>
            ) : !status ? (
              <p className="mt-3 text-sm text-critical">The server status could not be read.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-sm">
                <StatusRow ok={status.scanner.available} title="Browser scanner" detail={status.scanner.available ? `Chromium ${status.scanner.browser}, axe-core ${status.scanner.axeVersion}.` : "Run npx playwright install chromium, or set A11Y_CHROMIUM_PATH. URL and source scans need it."} />
                <StatusRow ok={status.figma.configured} optional title="Figma live import" detail={status.figma.configured ? "Configured. The token stays on the server." : "Set FIGMA_ACCESS_TOKEN to import by link. JSON exports work without it."} />
                <StatusRow ok={status.ai.configured} optional title="AI explanations" detail={status.ai.configured ? `On, using ${status.ai.provider}. Finding markup is sent to the provider only when you ask.` : "Set AI_PROVIDER and an API key to enable explanations for manual findings. Nothing is sent anywhere while it is off."} />
                <StatusRow ok title="Repository integration" optional unavailable detail="Not part of this version. Fixes are exported as .patch files; see docs/github-integration.md for the planned pull-request flow." />
              </ul>
            )}
          </section>

          <section aria-labelledby="privacy-h" className="panel p-5 sm:p-6">
            <h2 id="privacy-h" className="text-lg">Data in this browser</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
              <li>Audits, snapshots and fix decisions are kept in this tab&apos;s session storage and are deleted when the tab closes.</li>
              <li>The server keeps nothing after it responds. Source and page content are held only for the length of a scan.</li>
              <li>Settings on this page are kept in local storage. They contain no page content.</li>
            </ul>
            <p className="mt-3 text-sm">{audits.length} audit{audits.length === 1 ? "" : "s"} in this session.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {confirming ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => { clearAll(); setConfirming(false); announce("Session data cleared."); }}>Yes, clear everything</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Keep it</button>
                </>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={audits.length === 0} onClick={() => setConfirming(true)}>
                  <Trash2 aria-hidden="true" size={16} />
                  Clear session data
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function StatusRow({ ok, title, detail, optional, unavailable }: { ok: boolean; title: string; detail: string; optional?: boolean; unavailable?: boolean }) {
  const Icon = unavailable ? CircleDashed : ok ? CircleCheck : optional ? CircleDashed : CircleAlert;
  const label = unavailable ? "Not available" : ok ? "Ready" : optional ? "Not configured" : "Unavailable";
  return (
    <li className="flex gap-3 py-3">
      <Icon aria-hidden="true" size={18} className={`mt-0.5 shrink-0 ${unavailable ? "text-ink-3" : ok ? "text-resolved" : optional ? "text-ink-3" : "text-critical"}`} />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-xs font-semibold text-ink-3">{label}</p>
        <p className="text-ink-2">{detail}</p>
      </div>
    </li>
  );
}
