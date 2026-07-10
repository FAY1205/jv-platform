"use client";

import { Card, CardBody } from "@/components";
import { usePreferences, setPreferences, THEME_PREFS, type ThemePref } from "@/lib/preferences";
import { SettingsSection } from "../settings-section";

// WS-7c: Appearance — theme control on the UI-preferences store. "System" sets no
// data-theme so globals.css `prefers-color-scheme` decides; light/dark pin it.
const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };
const HINT: Record<ThemePref, string> = { system: "Match your device", light: "Always light", dark: "Always dark" };

export default function AppearanceSettingsPage() {
  const { theme } = usePreferences();
  return (
    <SettingsSection title="Appearance" description="Choose how the app looks. “System” follows your device setting.">
      <Card>
        <CardBody>
          <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-3">
            {THEME_PREFS.map((t) => {
              const on = theme === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPreferences({ theme: t })}
                  className={
                    "flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 " +
                    (on ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-3")
                  }
                >
                  <span className="text-sm font-semibold text-text">{LABEL[t]}</span>
                  <span className="text-xs text-text-3">{HINT[t]}</span>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
