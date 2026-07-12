import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// DSN-11 (WP-K): once the ladder is swept, none of these arbitrary text-size
// literal spellings may reappear in app source. The 5 remaining sub-13px
// arbitrary sites (values .6/.62/.66/.7rem) are intentionally NOT listed —
// they carry a documented token-gap comment pending slices B/D.
const BANNED = [
  "text-[13px]",
  "text-[.8125rem]",
  "text-[0.8125rem]",
  "text-[.95rem]",
  "text-[0.95rem]",
  "text-[2rem]",
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
