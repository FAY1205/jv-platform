import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkSrc } from "../helpers/walk-src";

// ─────────────────────────────────────────────────────────────────────────────
// WP-NF2b (owner decision 2026-08-20) — the workspace notification-preferences layer is
// RETIRED, and migration 0058 deletes the row that used to hold it.
//
// A deletion is not a decision until something stops it coming back. Two things could quietly
// resurrect this layer, and both are cheap to forbid:
//
//  1. A new reader of the `notification_prefs` settings key. Migration 0058's whole argument is
//     that an orphaned delivery-control row invites re-wiring; a source file that names the key
//     IS that re-wiring starting. The key is a plain string, so nothing but a scan catches it.
//  2. A resurrected loader/saver. `loadNotificationPrefs` / `saveNotificationPrefs` /
//     `mergeNotificationPrefs` / `NotificationPrefsSchema` were deleted as dead code; a helpful
//     re-introduction would restore the ceiling this WP removed without touching the key.
//
// The ONE allowed mention is the explanatory comment in prefs.ts (and the SQL + docs, which are
// not scanned) — the place the retirement is documented for whoever asks "wasn't there a
// tenant setting for this?".
// ─────────────────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..", "src");
const PREFS = ["modules", "notify", "prefs.ts"].join(sep);

/** Every .ts/.tsx file under src/, as src-relative paths. */
const files = walkSrc(SRC).map((p) => ({ path: relative(SRC, p), body: readFileSync(p, "utf8") }));

/** A line that is only a comment, in this codebase's two styles. Comments are where the
 *  retirement is EXPLAINED, so they are exactly what this scan must not flag. */
const isCommentLine = (line: string) => /^(\/\/|\*|\/\*)/.test(line.trimStart());

/** The key as a standalone token. Word-boundary-ish on both sides so the unrelated error codes
 *  `my_notification_prefs_failed` / `_save_failed` (route envelopes) are not false positives —
 *  they are envelope identifiers, not a settings key. */
const KEY = /(?<![\w-])notification_prefs(?![\w-])/;

const codeMentions = (body: string) => body.split("\n").filter((l) => !isCommentLine(l) && KEY.test(l));

describe("WP-NF2b: the workspace notification-prefs layer stays retired", () => {
  it("WP-NF2b: no source CODE references the `notification_prefs` settings key", () => {
    const offenders = files.filter((f) => codeMentions(f.body).length > 0).map((f) => f.path);
    expect(
      offenders,
      `These files reference the retired settings key in code. Notification delivery resolves as ` +
        `DEFAULT_NOTIFICATION_PREFS ⊕ the subject's own overlay (notification_pref_overrides) — ` +
        `there is no workspace layer, and migration 0058 deletes the row. If you need a per-seat ` +
        `preference, write an overlay via /api/me/notification-prefs.`,
    ).toEqual([]);
  });

  it("WP-NF2b: prefs.ts still DOCUMENTS the retirement, and reads no database at all", () => {
    const body = readFileSync(join(SRC, PREFS), "utf8");
    // The one mention that must survive: the note for whoever asks "wasn't there a tenant
    // setting for this?". A silent deletion is how the question gets re-answered wrongly.
    expect(body.split("\n").some((l) => isCommentLine(l) && KEY.test(l))).toBe(true);
    expect(codeMentions(body)).toEqual([]);
    // …and the module is now defaults + catalog: no db import, no query builder.
    expect(body).not.toMatch(/from\s+["']@\/db/);
    expect(body).not.toMatch(/drizzle-orm/);
  });

  it("WP-NF2b: the retired loader/saver/merge/schema stay deleted", () => {
    // CODE-only, for the same reason as the key scan: a comment that names a deleted symbol to
    // say it is deleted is a tombstone, not rot — `pref-overrides.ts` carries exactly one, so
    // the next reader of its spelled-out catalog knows where the old precedent went. An import,
    // a call or a re-declaration is the layer actually coming back, and that is what fails here.
    for (const symbol of [
      "loadNotificationPrefs",
      "saveNotificationPrefs",
      "mergeNotificationPrefs",
      "NotificationPrefsSchema",
      "NOTIFICATION_PREFS_KEY",
    ]) {
      // Whole-identifier match: the live `MY_NOTIFICATION_PREFS_KEY` (the personal card's query
      // key) CONTAINS `NOTIFICATION_PREFS_KEY` and is a different thing entirely.
      const token = new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`);
      const offenders = files
        .filter((f) => f.body.split("\n").some((l) => !isCommentLine(l) && token.test(l)))
        .map((f) => f.path);
      expect(offenders, `${symbol} is back — the workspace layer resolves through it`).toEqual([]);
    }
  });

  it("WP-NF2b: migration 0058 deletes the key and is registered in the journal", () => {
    const dir = join(SRC, "db", "migrations");
    const sqlPath = join(dir, "0058_retire_notification_prefs_setting.sql");
    expect(existsSync(sqlPath), "migration 0058 is missing").toBe(true);
    const sql = readFileSync(sqlPath, "utf8");
    // Key-SCOPED: every other settings key (colour coding, retention, AI config …) survives.
    expect(sql).toMatch(/DELETE FROM "settings" WHERE "key" = 'notification_prefs';/);
    expect(sql).not.toMatch(/DELETE FROM "settings";/);

    const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find((e) => e.tag === "0058_retire_notification_prefs_setting");
    expect(entry, "0058 is not in the drizzle journal — it would never be applied").toBeTruthy();
    // ⚠️ The migration-timestamp trap (memory): drizzle SKIPS a migration whose `when` is not
    // greater than the last applied one. 0057 is 1787154796243.
    const prior = journal.entries.filter((e) => e.idx < entry!.idx).map((e) => e.when);
    expect(entry!.when).toBeGreaterThan(Math.max(...prior));
  });
});
