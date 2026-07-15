import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { walkSrc } from "../helpers/walk-src";

// PRN-12 guard (D4; proposed by the T7a design-system review as "PRN-12b"): raw hex
// color literals may live ONLY in the documented homes below — every other file
// consumes semantic tokens. Mirrors the DSN-11 type-scale sweep (type-scale.test.ts).
// globals.css is the other token home but isn't scanned (the walk is .ts/.tsx only).
// NOTE: matches only #-prefixed hex. Bare 8-hex-digit ExcelJS ARGB strings ("FF000000",
// export/render.ts) are NOT caught — widening would false-positive on hashes/IDs; confine
// that convention to export/render.ts and eyeball new occurrences in review (D4 F-2).
const HEX_RE = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/;
const EXCEPTIONS = [
  "src/lib/tokens/tokens.ts", // THE token source (PRN-12)
  "src/modules/export/render.ts", // export ARGB contrast policy (WP-G/WP-H, FRONTEND_STANDARDS §3 carve-out)
  "src/components/assistant/Orb.tsx", // canvas plasma gradient (WP-AI-2, documented §3 carve-out)
];

const norm = (p: string) => p.replace(/\\/g, "/");

describe("PRN-12 hex-literal sweep", () => {
  it("PRN-12: no raw hex color literals outside the documented token homes", () => {
    const offenders: string[] = [];
    for (const file of walkSrc("src")) {
      if (EXCEPTIONS.includes(norm(file))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(HEX_RE);
        if (m) offenders.push(`${file}:${i + 1}  ${m[0]}`);
      });
    }
    expect(offenders, `hex literals outside the token homes:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("PRN-12: the exception list stays honest — every excepted file still exists and still contains hex", () => {
    for (const f of EXCEPTIONS) {
      const content = readFileSync(f, "utf8");
      expect(HEX_RE.test(content), `${f} no longer contains hex — remove it from EXCEPTIONS`).toBe(true);
    }
  });
});
