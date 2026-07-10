"use client";

import * as React from "react";

// WS-7 · the ONE small client UI-preferences store (frontend rule §6.17: a single UI
// store for preferences, never server data). Holds theme + nav-collapse, persisted to
// localStorage and synced across tabs. No new dependency — a tiny useSyncExternalStore
// over localStorage, generalizing the previous raw "jv.nav" flag. Server data never
// lives here.

export type ThemePref = "system" | "light" | "dark";
export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];

export interface Preferences {
  theme: ThemePref;
  navCollapsed: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: "system", navCollapsed: false };

const STORAGE_KEY = "jv.prefs";

function isThemePref(v: unknown): v is ThemePref {
  return v === "system" || v === "light" || v === "dark";
}

/** Parse stored prefs, tolerating null/garbage — never throws (falls back to defaults). */
export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      theme: isThemePref(o.theme) ? o.theme : DEFAULT_PREFERENCES.theme,
      navCollapsed: o.navCollapsed === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** The next theme in the system → light → dark → system cycle (profile-menu quick toggle). */
export function nextTheme(theme: ThemePref): ThemePref {
  return THEME_PREFS[(THEME_PREFS.indexOf(theme) + 1) % THEME_PREFS.length];
}

/** Theme → the `data-theme` attribute value. "system" ⇒ null: set no attribute so the
 *  CSS `prefers-color-scheme` default in globals.css decides (its `[data-theme]` override
 *  only wins when present). */
export function resolveDataTheme(theme: ThemePref): "light" | "dark" | null {
  return theme === "system" ? null : theme;
}

// ── client store (browser only; every access is inside a function) ──────────────
let cache: Preferences | null = null;
const listeners = new Set<() => void>();

function read(): Preferences {
  if (cache) return cache;
  cache = typeof window === "undefined" ? DEFAULT_PREFERENCES : parsePreferences(window.localStorage.getItem(STORAGE_KEY));
  return cache;
}

function emit() {
  for (const l of listeners) l();
}

/** Merge a patch into the stored prefs, persist, apply theme, and notify subscribers. */
export function setPreferences(patch: Partial<Preferences>): void {
  const next = { ...read(), ...patch };
  cache = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    applyTheme(next.theme);
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = parsePreferences(e.newValue); // cross-tab sync
      emit();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Subscribe a component to the preferences store. */
export function usePreferences(): Preferences {
  return React.useSyncExternalStore(subscribe, read, () => DEFAULT_PREFERENCES);
}

/** Set the `data-theme` attribute on <html> ("system" removes it, letting CSS decide). */
export function applyTheme(theme: ThemePref): void {
  if (typeof document === "undefined") return;
  const dt = resolveDataTheme(theme);
  if (dt) document.documentElement.setAttribute("data-theme", dt);
  else document.documentElement.removeAttribute("data-theme");
}

/** Keep <html data-theme> in sync with the stored theme. Mount once high in the tree. */
export function useApplyTheme(): void {
  const { theme } = usePreferences();
  React.useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}
