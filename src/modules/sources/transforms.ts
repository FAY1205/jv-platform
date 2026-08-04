import { normalizeHeader } from "./signature";
import { repairMojibake } from "./mojibake";
import type { CanonicalField } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Registered profile transforms (SEAM, ING-03). A Source Profile is DATA and can
// only NAME a transform; the code lives here — the same philosophy as MLS patterns.
// Column mapping alone cannot express this export: several canonical fields have to
// be DERIVED (a name split, an address decomposed, fields dug out of a notes blob).
//
// Every transform is PURE (PRN-01): no I/O, no Date.now(), same input ⇒ same output.
// File contents are DATA — never evaluated or trusted as instructions (PRN-10).
// ─────────────────────────────────────────────────────────────────────────────

type Canonical = Partial<Record<CanonicalField, string>>;

/** row + already-mapped columns ⇒ the canonical record. Must stay pure. */
export type ProfileTransform = (row: Record<string, unknown>, mapped: Canonical) => Canonical;

/** Read a source column tolerantly (case/whitespace-insensitive), like applyProfile. */
function pick(row: Record<string, unknown>, header: string): string {
  const want = normalizeHeader(header);
  for (const [key, value] of Object.entries(row)) {
    if (normalizeHeader(key) === want) return value == null ? "" : String(value);
  }
  return "";
}

/** Collapse ALL whitespace to single spaces. Guarantees the line regexes below can
 *  never see a newline, so `\s` in them cannot cross lines (the PRN-04 hazard). */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pull `Label: value` out of a multiline notes blob, trying each label in order.
 * ⚠️ [ \t] only — never \s (it crosses newlines and would bind a label to a value
 * on a different line). `\*?` absorbs the vendor's "* " bullet prefix.
 */
function notesField(notes: string, labels: readonly string[]): string {
  for (const label of labels) {
    const re = new RegExp(
      String.raw`^[ \t]*\*?[ \t]*${escapeRe(label)}[ \t]*:[ \t]*(.*)$`,
      "im",
    );
    const value = re.exec(notes)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * "12 Invented St, Springfield IL 62704" ⇒ address / city / state / zip.
 * Verified against 182 real rows: 182/182 decompose. ZIP+4 keeps the 5-digit ZIP.
 */
const ADDRESS_RE = /^(.*?),\s*(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/;

interface AddressParts {
  address: string;
  city: string;
  state: string;
  zip: string;
}

function decomposeAddress(raw: string): AddressParts | null {
  const m = ADDRESS_RE.exec(collapse(raw));
  if (!m) return null;
  return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
}

/**
 * SEC-05 — remove the skip-trace block (third-party phones/emails + DNC flags) from
 * the partner-visible notes, VALUES INCLUDED. Verified against the samples: the label
 * and its semicolon-separated values always share one line, so a line-level strip is
 * complete. Everything else stays — in particular the listing questions, because the
 * MLS filter runs on canonical notes. The untouched original lives on in raw_json.
 */
const SKIP_TRACE_LINE = /^[ \t]*\*?[ \t]*skip[ \t]+trace[ \t]+(?:emails|phones)[ \t]*:/i;

export function stripSkipTrace(notes: string): string {
  return notes
    .split("\n")
    .filter((line) => !SKIP_TRACE_LINE.test(line))
    .join("\n");
}

/**
 * ISO timestamp ⇒ plain date (`2026-07-07T17:30:37.714Z` ⇒ `2026-07-07`).
 * ⚠️ SLICED, never parsed: `new Date(...)` would apply the host timezone and could
 * shift the day, making the pipeline non-deterministic across machines (PRN-01).
 * Anything that isn't an ISO timestamp passes through untouched (never blanked).
 */
const ISO_DATE_RE = /^(\d{4}-\d{2}-\d{2})T/;

function isoDate(raw: string): string {
  return ISO_DATE_RE.exec(raw.trim())?.[1] ?? raw;
}

/** "Dana Fake" ⇒ first "Dana", last "Fake". Odd forms stay readable (never throws). */
function splitName(raw: string): { first: string; last: string } {
  const tokens = collapse(raw).split(" ").filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "" };
  return { first: tokens[0], last: tokens.slice(1).join(" ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// "Lead Source 1" (WP-LS1). Two vendor note templates live inside one export, so
// every notes lookup tries both label forms.
// ─────────────────────────────────────────────────────────────────────────────

export const transformLeadSource1: ProfileTransform = (row, mapped) => {
  // FU-1: the CRM bakes UTF-8-as-Windows-1252 mojibake into the notes ("âš ï¸ …").
  // Repair it at ingestion so the partner-visible notes (and the fields derived from
  // them) read cleanly; genuine text is left untouched (see mojibake.ts).
  const notes = stripSkipTrace(repairMojibake(mapped.notes ?? pick(row, "Notes")));

  // The dedicated `State` column is 0% populated in this export (measured) — the
  // territory key comes from Property Address, with the notes line as the fallback.
  const parts =
    decomposeAddress(mapped.address ?? pick(row, "Property Address")) ??
    decomposeAddress(notesField(notes, ["Full Address", "Address"]));

  const { first, last } = splitName(pick(row, "Contact Name"));

  return {
    ...mapped,
    notes,
    dateCreated: isoDate(mapped.dateCreated ?? pick(row, "Created on")),
    sellerFirst: first,
    sellerLast: last,
    // PRN-03: both address sources unusable ⇒ blank, NOT dropped. The lead still
    // ingests and surfaces in Unmatched for manual assignment.
    address: parts?.address ?? "",
    city: parts?.city ?? "",
    state: parts?.state ?? "",
    zip: parts?.zip ?? "",
    reasonForSelling: notesField(notes, ["Reason For Selling", "Reason for selling"]),
    timeToSell: notesField(notes, ["How Soon to Sell", "Sale urgency"]),
    // No equivalent field in this export (owner-confirmed 2026-07-15).
    motivation: "",
  };
};

/**
 * ⚠️ Object.create(null), NOT an object literal. `transform` is free-text from the DB,
 * and a literal inherits Object.prototype — so `TRANSFORMS["constructor"]` would resolve
 * to `Object`, a CALLABLE. applyProfile would invoke it, `Object(row, mapped)` returns
 * `row`, and the canonical record becomes the untouched source row: no address, no seller
 * name, and skip-trace values intact (SEC-05) — with no error raised. A null prototype
 * plus the typeof check below makes that unreachable.
 */
const TRANSFORMS: Readonly<Record<string, ProfileTransform>> = Object.assign(
  Object.create(null) as Record<string, ProfileTransform>,
  { "lead-source-1": transformLeadSource1 },
);

/**
 * Resolve a profile's named transform. THROWS on an unknown name: a profile row
 * naming a transform the code doesn't have is a data/deploy error, and silently
 * skipping it would ship leads with no address, no name, and un-stripped notes.
 */
export function getTransform(name: string): ProfileTransform {
  const transform = TRANSFORMS[name];
  // typeof, not truthiness: only a real function may ever be invoked as a transform.
  if (typeof transform !== "function") {
    throw new Error(
      `Unknown transform "${name}" — registered: ${Object.keys(TRANSFORMS).join(", ") || "(none)"}`,
    );
  }
  return transform;
}
