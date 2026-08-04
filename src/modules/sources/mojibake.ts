// ─────────────────────────────────────────────────────────────────────────────
// Mojibake repair (FU-1). The CRM "opportunities" export bakes text that is UTF-8
// bytes mis-decoded as Windows-1252 into its cells — an "⚠️" arrives as "âš ï¸".
// Our parser reads the bytes faithfully (parse.ts pins UTF-8), so the corruption is
// in the SOURCE. This reverses that one specific round-trip: map each character back
// to its Windows-1252 byte, then decode those bytes as UTF-8. A *fatal* decoder is the
// safety gate — genuine text (accented words, already-correct emoji) does not reverse
// into valid UTF-8, so it throws and the original is returned unchanged. PURE (PRN-01).
// ─────────────────────────────────────────────────────────────────────────────

// Windows-1252's printable assignments in 0x80–0x9F → the byte they came from. Every
// other character in 0x00–0xFF maps to its own code point as the byte.
const CP1252_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Reverse "UTF-8 read as Windows-1252" corruption in `s`. Returns `s` unchanged when it
 * is pure ASCII, when a character can't be a Windows-1252 byte, or when the reversed
 * bytes are not valid UTF-8 (the signature of real text, not mojibake).
 */
export function repairMojibake(s: string): string {
  // Pure ASCII is the overwhelming common case and can never be mojibake — skip the work.
  if (!/[^\x00-\x7f]/.test(s)) return s;

  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) {
      bytes.push(cp);
    } else {
      const b = CP1252_TO_BYTE.get(cp);
      if (b === undefined) return s; // a real char (emoji, CJK, …) — not our mojibake
      bytes.push(b);
    }
  }

  try {
    return utf8.decode(Uint8Array.from(bytes));
  } catch {
    return s; // reversed bytes aren't valid UTF-8 → genuine text; leave it alone
  }
}
