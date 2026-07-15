import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursive .ts/.tsx file walk for the source-scanning guard tests (type-scale,
 *  token-sweep) — one implementation so a future exclusion rule changes in one place. */
export function walkSrc(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walkSrc(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
