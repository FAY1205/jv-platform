import { describe, it, expect } from "vitest";
import { parsePreferences, resolveDataTheme, nextTheme, DEFAULT_PREFERENCES } from "@/lib/preferences";

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
    expect(parsePreferences(JSON.stringify({ theme: "dark" }))).toEqual({ theme: "dark", navCollapsed: false, navCollapsedPortal: false, leadsView: "list", leadsColumns: { hidden: [] } });
  });

  it("leadsColumns: round-trips a hidden set and degrades any garbage to nothing-hidden", () => {
    expect(DEFAULT_PREFERENCES.leadsColumns).toEqual({ hidden: [] });
    expect(parsePreferences(JSON.stringify({ leadsColumns: { hidden: ["seller", "tags"] } })).leadsColumns).toEqual({ hidden: ["seller", "tags"] });
    // Non-string entries are dropped; a non-array (or missing) hidden degrades to [].
    expect(parsePreferences(JSON.stringify({ leadsColumns: { hidden: ["seller", 3, null] } })).leadsColumns).toEqual({ hidden: ["seller"] });
    expect(parsePreferences(JSON.stringify({ leadsColumns: "nope" })).leadsColumns).toEqual({ hidden: [] });
    expect(parsePreferences(JSON.stringify({ navCollapsed: true })).leadsColumns).toEqual({ hidden: [] });
  });

  it("KAN-01: the Leads view choice round-trips, defaulting to the list (PRN-11)", () => {
    expect(DEFAULT_PREFERENCES.leadsView).toBe("list");
    expect(parsePreferences(JSON.stringify({ leadsView: "board" })).leadsView).toBe("board");
    // Anything else — an old payload, a typo, a future value — degrades to the list.
    expect(parsePreferences(JSON.stringify({ leadsView: "kanban" })).leadsView).toBe("list");
    expect(parsePreferences(JSON.stringify({ navCollapsed: true })).leadsView).toBe("list");
  });

  it("falls back to the default theme when the stored value isn't a valid ThemePref", () => {
    expect(parsePreferences(JSON.stringify({ theme: "neon" })).theme).toBe("system");
  });

  it("coerces navCollapsed to a boolean", () => {
    expect(parsePreferences(JSON.stringify({ navCollapsed: true })).navCollapsed).toBe(true);
    expect(parsePreferences(JSON.stringify({ navCollapsed: "yes" })).navCollapsed).toBe(false);
  });

  it("D4: navCollapsedPortal is independent of the admin navCollapsed", () => {
    const p = parsePreferences(JSON.stringify({ navCollapsed: true }));
    expect(p.navCollapsed).toBe(true);
    expect(p.navCollapsedPortal).toBe(false); // collapsing the admin rail never collapses the portal's
    expect(parsePreferences(JSON.stringify({ navCollapsedPortal: true })).navCollapsedPortal).toBe(true);
  });
});

describe("resolveDataTheme (DSN-01)", () => {
  it("DSN-01: maps 'system' to null so no data-theme attribute is set (CSS prefers-color-scheme wins)", () => {
    expect(resolveDataTheme("system")).toBeNull();
  });

  it("maps explicit prefs straight through", () => {
    expect(resolveDataTheme("light")).toBe("light");
    expect(resolveDataTheme("dark")).toBe("dark");
  });
});

describe("nextTheme (DSN-01)", () => {
  it("DSN-01: cycles system → light → dark → system (for the profile-menu quick toggle)", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
