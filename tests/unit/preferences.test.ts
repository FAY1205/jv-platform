import { describe, it, expect } from "vitest";
import { parsePreferences, resolveDataTheme, DEFAULT_PREFERENCES } from "@/lib/preferences";

// WS-7 Appearance: the single small UI-preferences store (theme + nav collapse), persisted
// to localStorage. These are the pure, DOM-free parts — safe parsing (never throws on
// garbage) and the theme→data-theme mapping ("system" means: set no attribute and let the
// CSS prefers-color-scheme default win, per globals.css).

describe("parsePreferences", () => {
  it("returns defaults for null (nothing stored yet)", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns defaults for non-JSON garbage (never throws)", () => {
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
  });

  it("fills missing keys from defaults", () => {
    expect(parsePreferences(JSON.stringify({ theme: "dark" }))).toEqual({ theme: "dark", navCollapsed: false });
  });

  it("falls back to the default theme when the stored value isn't a valid ThemePref", () => {
    expect(parsePreferences(JSON.stringify({ theme: "neon" })).theme).toBe("system");
  });

  it("coerces navCollapsed to a boolean", () => {
    expect(parsePreferences(JSON.stringify({ navCollapsed: true })).navCollapsed).toBe(true);
    expect(parsePreferences(JSON.stringify({ navCollapsed: "yes" })).navCollapsed).toBe(false);
  });
});

describe("resolveDataTheme", () => {
  it("maps 'system' to null so no data-theme attribute is set (CSS prefers-color-scheme wins)", () => {
    expect(resolveDataTheme("system")).toBeNull();
  });

  it("maps explicit prefs straight through", () => {
    expect(resolveDataTheme("light")).toBe("light");
    expect(resolveDataTheme("dark")).toBe("dark");
  });
});
