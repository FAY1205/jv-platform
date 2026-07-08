import { normalizeZip, normalizeState } from "../pipeline/normalize";

// CVG-01: parse the free-text ZIP / state lists the owner types on the partner
// screen. Tokens split on any run of commas / whitespace / semicolons; each is
// normalized (reusing the pipeline normalizers, NRM-01) and deduped. Non-ZIP /
// non-state tokens are surfaced so the owner can fix them. PURE.

function tokens(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
}

// A real ZIP's first digit group is 3–5 digits (e.g. "501" → 00501 exists; Excel
// drops leading zeros so "6404" → 06404). 1–2 digit tokens are typos, not ZIPs.
function zipDigitGroup(token: string): string {
  return token.split(/\D+/).filter(Boolean)[0] ?? "";
}

export interface ParseResult {
  valid: string[];
  invalid: string[];
}

export function parseZipList(raw: string): ParseResult {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens(raw)) {
    const group = zipDigitGroup(t);
    if (group.length >= 3 && group.length <= 5) {
      const zip = normalizeZip(t);
      if (!seen.has(zip)) {
        seen.add(zip);
        valid.push(zip);
      }
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}

export function parseStateList(raw: string): ParseResult {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens(raw)) {
    const st = normalizeState(t);
    if (/^[A-Z]{2}$/.test(st)) {
      if (!seen.has(st)) {
        seen.add(st);
        valid.push(st);
      }
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}
