import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// DSN-11 (WP-K + WP-P): once the ladder is swept, none of these arbitrary
// text-size literal spellings may reappear in app source. WP-P (slice B2)
// resolved the 4 readable sub-12px sites (.62/.66/.7rem) to text-step-0 and
// added them here as a regression floor. ONE GLYPH-FIT carve-out remains by
// design and is intentionally NOT banned: the NotificationBell unread-count
// badge (text-[.6rem], fits a 16px circle) — sized to its container, not to a
// reading step (FRONTEND_STANDARDS §2, glyph-fit exemption). (The other
// carve-out, the hex map's on-polygon labels, retired with the hex map — D1.)
const BANNED = [
  "text-[13px]",
  "text-[.8125rem]",
  "text-[0.8125rem]",
  "text-[.95rem]",
  "text-[0.95rem]",
  "text-[2rem]",
  // WP-P: 4 readable sub-12px sites resolved to text-step-0.
  "text-[.62rem]",
  "text-[0.62rem]",
  "text-[.66rem]",
  "text-[0.66rem]",
  "text-[.7rem]",
  "text-[0.7rem]",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("DSN-11 type-scale sweep", () => {
  it("DSN-11: no swept text-size literals remain in src/", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const b of BANNED) {
          if (line.includes(b)) offenders.push(`${file}:${i + 1}  ${b}`);
        }
      });
    }
    expect(offenders, `swept literals still present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
