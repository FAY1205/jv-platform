# WP-G — Email + Export Brand Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the digest + all partner-facing emails a Survey-branded HTML look (mockup 11), and
fix + verify the export's partner-tint text contrast (mockup 12) — one WP-G commit.

**Architecture:** A new pure `email-template.ts` shell (table-based, fully-inline HTML, light-theme
values imported from `lightColors` per SEAM-08) is composed by the digest builders (`digests.ts`)
and the auth builders (`lib/auth/notify.ts`). Auth emails carry HTML with zero plumbing
(`EmailMessage.html` already exists); digests travel through a new nullable `email_outbox.html`
column. The export's `contrastText` is rewritten from a YIQ threshold to a WCAG max-contrast pick.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + Postgres, ExcelJS, Vitest (jsdom), pnpm.

## Global Constraints

- **PRN-01 / purity:** email builders and `contrastText` take input → string; no DB/fetch/Date.now.
- **PRN-12 / SEAM-08:** no hardcoded hex or product name in template code. Inline color/font values
  come from `lightColors` (`@/lib/tokens/tokens`); product name is `APP_NAME` (`@/lib/app`).
- **PRN-14:** partner color never alone — name + `JV-###` accompany it (digest intro, export rows,
  legend).
- **SEC-05:** digests carry lead refId + city/state only — never seller phone/email.
- **SEC-06:** export cell sanitization (`^[=+\-@\t\r]`) is untouched.
- **SEC-07:** non-prod never emails a real partner — the `guardOutbound` sink + `DevMailboxTransport`
  are untouched; this WP changes only message *content*.
- **Escaping:** every interpolated value in email HTML passes through `escapeHtml`.
- **Commits:** per the project's WP process (CLAUDE.md), tasks are implemented + verified
  incrementally but committed as a **single WP-G commit** after the owner walkthrough (Task 7) —
  NOT per task. Each task below ends with a test-run checkpoint, not a commit.
- **Test runner:** `pnpm test:unit -- --no-file-parallelism` (jsdom OOMs in parallel);
  `pnpm typecheck` separately; lint only the changed files.

---

### Task 1: Export — WCAG max-contrast `contrastText` + legend cell + AA test

**Files:**
- Modify: `src/modules/export/render.ts` (the `contrastText` helper ~L83-91; legend loop ~L190-196)
- Test: `tests/unit/export-contrast.test.ts` (create)

**Interfaces:**
- Produces: `export function contrastText(hex: string): "FF000000" | "FFFFFFFF"` (now exported).

- [ ] **Step 1: Write the failing test** — `tests/unit/export-contrast.test.ts`

```ts
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { contrastText, renderExport, type ExportLead, type PartnerInfo } from "@/modules/export/render";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";
import type { RunSummary } from "@/modules/analytics/run-summary";

// WCAG relative-luminance contrast (SC 1.4.3), for asserting the picked ink meets AA.
function relLum(hex: string): number {
  const h = hex.replace(/^#|^FF/i, "");
  const ch = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const argbToHex = (argb: string) => "#" + argb.slice(2);

describe("EXP-06/PRN-14: export text meets WCAG AA on every partner tint", () => {
  it("contrastText picks an AA (>=4.5:1) ink for all 20 swatches", () => {
    for (const swatch of PARTNER_SWATCHES) {
      const ink = argbToHex(contrastText(swatch));
      expect(ratio(ink, swatch), `swatch ${swatch}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("legend color cells + color-ON rows carry an AA font color for a dark tint", async () => {
    const dark = "#7A3B45"; // wine — black default text would be ~2.5:1
    const partners = new Map<string, PartnerInfo>([["p1", { id: "p1", name: "Wine Co", refId: "JV-777", color: dark }]]);
    const leads: ExportLead[] = [{
      leadRefId: "LD-1", campaign: "Z", dateCreated: "2026-07-06", notes: "", address: "1 A St",
      city: "Greenville", state: "SC", zip: "29601", sellerFirst: "S", sellerLast: "R", phone: "",
      email: "", reasonForSelling: "", motivation: "", timeToSell: "", partnerId: "p1",
      previouslyMatched: false, possibleMlsListing: "unknown",
    }];
    const summary: RunSummary = { total: 1, kept: 1, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "p1", count: 1 }] };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExport(leads, partners, summary, { colorCoding: true })) as unknown as ArrayBuffer);

    const legendCell = wb.getWorksheet("JV_Color_Legend")!.getRow(2).getCell(3);
    expect(ratio(argbToHex(String(legendCell.font!.color!.argb)), dark)).toBeGreaterThanOrEqual(4.5);

    const leadsWs = wb.getWorksheet("Leads")!;
    let dataCellArgb: string | undefined;
    leadsWs.eachRow((row) => { if (String(row.getCell(1).value ?? "") === "LD-1") dataCellArgb = String(row.getCell(1).font?.color?.argb); });
    expect(ratio(argbToHex(dataCellArgb!), dark)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/export-contrast.test.ts`
Expected: FAIL — `contrastText` is not exported (import error) and the legend cell has no font color.

- [ ] **Step 3: Rewrite `contrastText` (pure black/white, exported) in `src/modules/export/render.ts`**

Replace the existing `contrastText` (currently `luminance > 0.6 ? black : white`) with:

```ts
/**
 * Pick black or white text for the strongest WCAG contrast against a fill
 * (PRN-14, SC 1.4.3). Supersedes the old YIQ-brightness heuristic, which chose the
 * FAILING color on ~40% of the Survey partner tints (e.g. clay #B4623F, seafoam
 * #5E9E8E). Pure black/white — not #111 — is required to keep AA margin on the
 * borderline tints (clay, slate). Returns exceljs ARGB.
 */
export function contrastText(hex: string): "FF000000" | "FFFFFFFF" {
  const relLum = (h: string): number => {
    const c = h.replace(/^#/, "");
    const ch = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a: string, b: string): number => {
    const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  return ratio("#000000", hex) >= ratio("#FFFFFF", hex) ? "FF000000" : "FFFFFFFF";
}
```

- [ ] **Step 4: Apply the font color to the legend color cell** in `renderExport` (the
  `JV_Color_Legend` loop). Replace:

```ts
    const row = legend.addRow([sanitizeCell(p.name), p.refId, p.color]); // SEC-06: partner name (F-26)
    row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(p.color) } };
```

with:

```ts
    const row = legend.addRow([sanitizeCell(p.name), p.refId, p.color]); // SEC-06: partner name (F-26)
    const colorCell = row.getCell(3);
    colorCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(p.color) } };
    colorCell.font = { color: { argb: contrastText(p.color) } }; // PRN-14: hex text stays AA on its fill
```

- [ ] **Step 5: Run the new test + the existing export tests — all green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/export-contrast.test.ts tests/unit/export.test.ts tests/unit/export-render.test.ts`
Expected: PASS. (Existing `export.test.ts` asserts the font color matches `/^FF(000000|FFFFFF)$/` — still true.)

---

### Task 2: Email shell — `email-template.ts` (pure)

**Files:**
- Create: `src/modules/notify/email-template.ts`
- Test: `tests/unit/email-template.test.ts` (create)

**Interfaces:**
- Produces:
  - `escapeHtml(value: string): string`
  - `emailButton(input: { href: string; label: string }): string`
  - `renderEmailDocument(input: { title: string; preheader: string; contentHtml: string }): string`
  - `EMAIL_COLORS: typeof lightColors` and `EMAIL_FONTS: { display: string; body: string; mono: string }`

- [ ] **Step 1: Write the failing test** — `tests/unit/email-template.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS } from "@/modules/notify/email-template";
import { lightColors } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

describe("escapeHtml", () => {
  it("neutralises HTML-significant characters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("emailButton", () => {
  it("renders an anchor with the marigold fill value and an escaped href/label", () => {
    const html = emailButton({ href: "https://app.test/x?a=1&b=2", label: "Open <leads>" });
    expect(html).toContain(lightColors.brand); // fill from the token source (SEAM-08)
    expect(html).toContain("https://app.test/x?a=1&amp;b=2");
    expect(html).toContain("Open &lt;leads&gt;");
  });
});

describe("renderEmailDocument", () => {
  const doc = renderEmailDocument({ title: "T", preheader: "P", contentHtml: "<p>hello</p>" });
  it("is one HTML document that inlines the content", () => {
    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc).toContain("<p>hello</p>");
    expect(doc).toContain("P"); // preheader
  });
  it("uses APP_NAME, never a hardcoded product name", () => {
    expect(doc).toContain(APP_NAME);
    expect(doc).not.toContain("TerritoryDesk");
  });
  it("re-exports the light token palette for content builders", () => {
    expect(EMAIL_COLORS).toBe(lightColors);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/email-template.test.ts`
Expected: FAIL — module `email-template` does not exist.

- [ ] **Step 3: Create `src/modules/notify/email-template.ts`**

```ts
import { lightColors } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

// ─────────────────────────────────────────────────────────────────────────────
// Survey email shell (NTF-03, SEAM-08, PRN-12). PURE HTML builders. Emails cannot
// read CSS variables and Outlook needs table layout, so every value is inlined from
// the token source. The LIGHT theme is the canonical brand look — dark-mode email
// theming is intentionally out of scope. No hardcoded hex or product name lives here;
// content builders compose this shell and pass only escaped fragments.
// ─────────────────────────────────────────────────────────────────────────────

export const EMAIL_COLORS = lightColors;

export const EMAIL_FONTS = {
  display: "Georgia, 'Times New Roman', serif",
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SF Mono', ui-monospace, 'Roboto Mono', Menlo, Consolas, monospace",
} as const;

/** HTML-escape a value before interpolating it into an email template. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A padded <a> CTA (marigold fill, brand-contrast ink). Degrades to a plain link in Outlook. */
export function emailButton(input: { href: string; label: string }): string {
  const C = EMAIL_COLORS;
  return (
    `<a href="${escapeHtml(input.href)}" style="display:inline-block;background:${C.brand};` +
    `color:${C.brandContrast};font-family:${EMAIL_FONTS.body};font-weight:700;font-size:15px;` +
    `text-decoration:none;padding:13px 26px;border-radius:8px;border:1px solid ${C.brandStrong}">` +
    `${escapeHtml(input.label)}</a>`
  );
}

/** Wrap pre-rendered inner HTML in the branded, table-based, 600px email shell. */
export function renderEmailDocument(input: { title: string; preheader: string; contentHtml: string }): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const brand = escapeHtml(APP_NAME);
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.surface2};font-family:${F.body};color:${C.text}">` +
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</span>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface2}"><tr>` +
    `<td align="center" style="padding:28px 16px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;` +
    `background:${C.surface};border:1px solid ${C.border};border-radius:16px;overflow:hidden">` +
    // header
    `<tr><td style="padding:18px 24px;border-bottom:1px solid ${C.border}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="width:26px;height:26px;background:${C.brand};border:1px solid ${C.brandStrong};border-radius:7px"></td>` +
    `<td style="padding-left:10px;font-family:${F.display};font-size:18px;color:${C.text}">${brand}</td>` +
    `</tr></table></td></tr>` +
    // content
    `<tr><td style="padding:6px 24px 26px">${input.contentHtml}</td></tr>` +
    // footer
    `<tr><td style="padding:18px 24px;border-top:1px solid ${C.border};background:${C.surface2};` +
    `font-family:${F.body};font-size:13px;color:${C.text3}">${brand} · Lead routing</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/email-template.test.ts`
Expected: PASS.

---

### Task 3: Digest HTML builders — `digests.ts`

**Files:**
- Modify: `src/modules/notify/digests.ts`
- Test: `tests/unit/digests.test.ts` (extend)

**Interfaces:**
- Consumes: `escapeHtml`, `emailButton`, `renderEmailDocument`, `EMAIL_COLORS`, `EMAIL_FONTS` (Task 2).
- Produces:
  - `PartnerDigestInput` gains `partnerRef: string` (required) and `partnerColor?: string`.
  - `AdminSummaryInput` gains `importUrl?: string`.
  - `DigestContent` gains `html: string`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/digests.test.ts` and update the
  existing `input` object to include `partnerRef`.

Update the existing `const input = {...}` (add `partnerRef`):

```ts
  const input = {
    appName: "JV Platform",
    partnerName: "Randy Wolfe",
    partnerRef: "JV-001",
    portalUrl: "https://app.test/portal",
    uploadRef: "IM-26-014",
    leads: [
      { refId: "LD-26-00007", city: "Austin", state: "TX" },
      { refId: "LD-26-00008", city: "Dallas", state: "TX" },
    ],
  };
```

Append these tests:

```ts
describe("buildPartnerDigest — HTML (WP-G, mockup 11)", () => {
  const base = {
    appName: "JV Platform", partnerName: "Randy Wolfe", partnerRef: "JV-001",
    portalUrl: "https://app.test/portal", uploadRef: "IM-26-014",
    leads: [{ refId: "LD-26-00007", city: "Austin", state: "TX" }],
  };

  it("NTF-01: html carries an HTML document with refId + location + portal CTA", () => {
    const { html } = buildPartnerDigest(base);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("LD-26-00007");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("https://app.test/portal");
  });

  it("PRN-14: html names the partner + JV-### (color never alone)", () => {
    expect(buildPartnerDigest(base).html).toContain("Randy Wolfe (JV-001)");
  });

  it("SEC-05: html never leaks seller PII", () => {
    expect(buildPartnerDigest(base).html).not.toMatch(/@/);
  });

  it("escapes an injected partner name (no raw markup)", () => {
    const { html } = buildPartnerDigest({ ...base, partnerName: "<b>x</b>" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("buildAdminRunSummary — HTML (WP-G)", () => {
  it("NTF-02: html carries the totals + a View-import CTA when importUrl is given", () => {
    const { html } = buildAdminRunSummary({
      appName: "JV Platform", uploadRef: "IM-26-014", importUrl: "https://app.test/imports/IM-26-014",
      summary: { total: 50, kept: 24, removed: 26, unmatched: 1, previouslyMatched: 3, perPartner: [{ partnerId: "p1", count: 24 }] },
    });
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("24");
    expect(html).toContain("https://app.test/imports/IM-26-014");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/digests.test.ts`
Expected: FAIL — `html` is undefined; `partnerRef`/`importUrl` types missing.

- [ ] **Step 3: Implement HTML in `src/modules/notify/digests.ts`**

Add the import at the top:

```ts
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS, EMAIL_FONTS } from "./email-template";
```

Extend the interfaces:

```ts
export interface PartnerDigestInput {
  appName: string;
  partnerName: string;
  partnerRef: string;          // JV-### (PRN-14)
  portalUrl: string;
  uploadRef: string;
  leads: PartnerDigestLead[];
  partnerColor?: string;       // locked partner color (PRN-06) — renders the row swatch when present
}

export interface DigestContent {
  subject: string;
  body: string;
  html: string;
}

export interface AdminSummaryInput {
  appName: string;
  uploadRef: string;
  summary: RunSummary;
  importUrl?: string;          // deep link to the import (optional CTA)
}
```

Add a private HTML renderer for the partner digest and return `html` from `buildPartnerDigest`:

```ts
function partnerDigestHtml(input: PartnerDigestInput): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const n = input.leads.length;
  const noun = n === 1 ? "new lead" : "new leads";
  const swatch = input.partnerColor
    ? `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${escapeHtml(input.partnerColor)};border:1px solid rgba(0,0,0,.18);vertical-align:middle;margin-right:10px"></span>`
    : "";
  const rows = input.leads
    .map(
      (l) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.border};font-family:${F.body}">` +
        swatch +
        `<span style="font-family:${F.mono};font-weight:600;color:${C.text}">${escapeHtml(l.refId)}</span>` +
        `<span style="color:${C.text3};font-size:14px"> · ${escapeHtml(locationOf(l))}</span>` +
        `</td></tr>`,
    )
    .join("");
  const content =
    `<div style="text-align:center;background:${C.brandSoft};margin:6px -24px 20px;padding:26px 24px;` +
    `border-bottom:1px solid ${C.brandLine}">` +
    `<div style="font-family:${F.display};font-size:42px;line-height:1;color:${C.brandInk}">${n}</div>` +
    `<div style="font-family:${F.body};font-size:15px;color:${C.text2};margin-top:4px">${noun} in your territory</div></div>` +
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Here's what routed to ` +
    `<strong style="color:${C.text}">${escapeHtml(input.partnerName)} (${escapeHtml(input.partnerRef)})</strong> ` +
    `today. Reach new sellers within a day for the best response.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>` +
    `<div style="margin-top:22px">${emailButton({ href: input.portalUrl, label: "Open your leads →" })}</div>`;
  return renderEmailDocument({
    title: `${n} ${noun} — ${input.appName}`,
    preheader: `${n} ${noun} routed to ${input.partnerName}`,
    contentHtml: content,
  });
}
```

In `buildPartnerDigest`, add `html: partnerDigestHtml(input),` to the returned object.

Add an admin-summary HTML renderer + return `html` from `buildAdminRunSummary`:

```ts
function adminSummaryHtml(input: AdminSummaryInput): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const s = input.summary;
  const delivered = s.perPartner.reduce((t, p) => t + p.count, 0);
  const stat = (label: string, value: number) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.border};font-family:${F.body};color:${C.text2};font-size:14px">${label}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid ${C.border};font-family:${F.mono};color:${C.text};text-align:right">${value}</td></tr>`;
  const cta = input.importUrl ? `<div style="margin-top:22px">${emailButton({ href: input.importUrl, label: "View import →" })}</div>` : "";
  const content =
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Run <strong style="color:${C.text}">${escapeHtml(input.uploadRef)}</strong> processed.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    stat("Total rows", s.total) + stat("Distributed (kept)", s.kept) + stat("Assigned to partners", delivered) +
    stat("Removed (MLS-listed)", s.removed) + stat("Unmatched", s.unmatched) + stat("Previously matched", s.previouslyMatched) +
    `</table>${cta}`;
  return renderEmailDocument({ title: `Run summary — ${input.uploadRef}`, preheader: `Run ${input.uploadRef} processed`, contentHtml: content });
}
```

In `buildAdminRunSummary`, add `html: adminSummaryHtml(input),` to the returned object.

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/digests.test.ts`
Expected: PASS.

---

### Task 4: Auth email HTML — `lib/auth/notify.ts`

**Files:**
- Modify: `src/lib/auth/notify.ts`
- Test: `tests/unit/auth-email.test.ts` (create)

**Interfaces:**
- Consumes: `escapeHtml`, `emailButton`, `renderEmailDocument`, `EMAIL_COLORS`, `EMAIL_FONTS` (Task 2).
- Produces: every `build*Email` in this file now sets `html` on its `EmailMessage`.

- [ ] **Step 1: Write the failing test** — `tests/unit/auth-email.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildInviteEmail, buildOtpEmail, buildResetEmail, buildPasswordChangedEmail } from "@/lib/auth/notify";

describe("WP-G: auth emails carry branded HTML without breaking the text contract", () => {
  it("invite: html has the link CTA; text keeps the raw link (dev-mailbox LINK_RE)", () => {
    const m = buildInviteEmail("p@x.test", "https://app.test/invite/abc?t=1&u=2");
    expect(m.html).toMatch(/^<!DOCTYPE html>/i);
    expect(m.html).toContain("https://app.test/invite/abc?t=1&amp;u=2");
    expect(m.text).toContain("https://app.test/invite/abc?t=1&u=2");
  });

  it("otp: html shows the code; text still carries it verbatim (dev-mailbox CODE_RE)", () => {
    const m = buildOtpEmail("p@x.test", "123456");
    expect(m.html).toContain("123456");
    expect(m.text).toContain("123456");
  });

  it("reset: html + text both present", () => {
    const m = buildResetEmail("p@x.test", "https://app.test/reset/xyz");
    expect(m.html).toContain("https://app.test/reset/xyz");
    expect(m.text).toContain("https://app.test/reset/xyz");
  });

  it("password-changed: html present, honest revocation copy preserved", () => {
    expect(buildPasswordChangedEmail("p@x.test", true).html).toContain("signed out");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/auth-email.test.ts`
Expected: FAIL — `html` is undefined on these messages.

- [ ] **Step 3: Add HTML to `src/lib/auth/notify.ts`**

Add imports:

```ts
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS, EMAIL_FONTS } from "@/modules/notify/email-template";
```

Add a local notice helper (DRY for the terse security notices):

```ts
function authNotice(opts: { title: string; paragraphs: string[]; cta?: { href: string; label: string }; code?: string }): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const codeBlock = opts.code
    ? `<div style="font-family:${F.mono};font-size:34px;letter-spacing:8px;font-weight:700;color:${C.text};` +
      `background:${C.surface2};border:1px solid ${C.border};border-radius:8px;text-align:center;padding:18px 0;margin:6px 0 14px">${escapeHtml(opts.code)}</div>`
    : "";
  const body = opts.paragraphs
    .map((p) => `<p style="font-family:${F.body};color:${C.text2};font-size:15px">${escapeHtml(p)}</p>`)
    .join("");
  const cta = opts.cta ? `<div style="margin-top:20px">${emailButton(opts.cta)}</div>` : "";
  return renderEmailDocument({ title: opts.title, preheader: opts.title, contentHtml: body + codeBlock + cta });
}
```

Then set `html` on each builder (keep every `to`/`subject`/`text`/`meta` exactly as-is; add one field):

```ts
// buildLockoutEmail
html: authNotice({ title: "Your account was temporarily locked", paragraphs: ["We detected repeated failed sign-in attempts and temporarily locked your account for safety. It unlocks automatically after a short delay. If this wasn't you, reset your password."] }),

// buildAnomalyEmail
html: authNotice({ title: "Security alert: sustained failed sign-in attempts", paragraphs: [`Automated security alert: ${detail}. Review the activity log.`] }),

// buildResetEmail
html: authNotice({ title: "Reset your password", paragraphs: ["We received a request to reset your password. Use the button below within 30 minutes. If you didn't request this, you can ignore this email."], cta: { href: link, label: "Reset your password" } }),

// buildPasswordChangedEmail  (revocationLine already computed above the return)
html: authNotice({ title: "Your password was changed", paragraphs: [`Your password was just changed. ${revocationLine} If this wasn't you, reset your password immediately and contact your administrator.`] }),

// buildInviteEmail
html: authNotice({ title: `You've been invited to ${APP_NAME}`, paragraphs: [`You've been invited to the ${APP_NAME} partner portal. Open the link below and enter your email to receive a 6-digit sign-in code.`], cta: { href: link, label: "Accept your invite →" } }),

// buildOtpEmail
html: authNotice({ title: "Your sign-in code", paragraphs: [`Your ${APP_NAME} sign-in code:`], code, cta: undefined }),
// (append after the code block, as a paragraph, the expiry note — include it in paragraphs BEFORE code instead:)
// paragraphs: [`Your ${APP_NAME} sign-in code:`] then code; the expiry line can be a second paragraph rendered after — simplest: keep expiry in the same first flow via two paragraphs is awkward with code between. Acceptable: show code then rely on subject/text for expiry, OR add expiry to paragraphs and accept it renders above the code.

// buildTrustReuseEmail
html: authNotice({ title: "Security alert: a saved device was signed out", paragraphs: ["We detected reuse of an old 'remember this device' token on your account and signed that device family out as a precaution. If this wasn't you, sign in and review your devices."] }),
```

For OTP expiry copy, put the code first then a trailing note by passing a second element rendered after the code — simplest correct form: render code via `code`, and include the expiry sentence as a paragraph (it will appear above the code, which is fine). Use:
`paragraphs: [\`Your ${APP_NAME} sign-in code (expires in 10 minutes):\`], code`.

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/auth-email.test.ts`
Expected: PASS.

---

### Task 5: Outbox plumbing + `email_outbox.html` migration

**Files:**
- Modify: `src/db/schema.ts` (emailOutbox — add `html`)
- Create: `src/db/migrations/0016_*.sql` + meta snapshot (via `pnpm db:generate`)
- Modify: `src/modules/notify/outbox.ts` (EnqueueEmailInput, enqueueEmail, enqueueRunDigests,
  notifyStatusChange, drainOutbox + new pure `rowToEmailMessage`)
- Test: `tests/unit/outbox-row.test.ts` (create — the pure mapper)

**Interfaces:**
- Consumes: `DigestContent.html` (Task 3), `renderEmailDocument` (Task 2).
- Produces: `export function rowToEmailMessage(row: { toAddress: string; subject: string; body: string; html: string | null; kind: string }): EmailMessage`.

- [ ] **Step 1: Write the failing unit test** — `tests/unit/outbox-row.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { rowToEmailMessage } from "@/modules/notify/outbox";

describe("rowToEmailMessage (NTF-03 drain mapping)", () => {
  const base = { toAddress: "p@x.test", subject: "S", body: "text body", kind: "partner_digest" };
  it("includes html when the row has it (multipart)", () => {
    const m = rowToEmailMessage({ ...base, html: "<p>hi</p>" });
    expect(m).toMatchObject({ to: "p@x.test", subject: "S", text: "text body", html: "<p>hi</p>", meta: { kind: "partner_digest" } });
  });
  it("omits html when null (text-only, backward-compatible)", () => {
    expect(rowToEmailMessage({ ...base, html: null }).html).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/outbox-row.test.ts`
Expected: FAIL — `rowToEmailMessage` not exported.

- [ ] **Step 3: Add the `html` column to `src/db/schema.ts`** (in `emailOutbox`, right after `body`):

```ts
    body: text("body").notNull(),
    html: text("html"), // rendered HTML alternative (NTF-03/WP-G); null → text-only send
```

- [ ] **Step 4: Generate + annotate the migration**

Run: `pnpm db:generate`
Expected: creates `src/db/migrations/0016_<name>.sql` containing
`ALTER TABLE "email_outbox" ADD COLUMN "html" text;` and updates the meta snapshot + `_journal.json`.
Then prepend a comment to the generated `.sql` documenting the schema-change checklist:

```sql
-- WP-G (NTF-03): add a nullable HTML alternative to the email outbox so branded digest
-- HTML (mockup 11) travels to the drain. Additive + nullable:
--   • RLS  — unchanged: email_outbox is deny-by-default / service-role (migration 0008); no policy touches this column.
--   • Index — none: `html` is never a query predicate (outbox is drained by status+next_attempt_at).
--   • Seed — none: existing rows stay NULL; the drain falls back to text-only.
ALTER TABLE "email_outbox" ADD COLUMN "html" text;
```

- [ ] **Step 5: Apply to the local dev DB** (so integration tests keep running)

Run: `pnpm db:migrate`
Expected: `0016` applied, no error.

- [ ] **Step 6: Wire `outbox.ts`**

Add the shell import (for the status-change notice):

```ts
import { renderEmailDocument, escapeHtml, EMAIL_COLORS, EMAIL_FONTS } from "./email-template";
```

`EnqueueEmailInput` — add `html?: string;`. In `enqueueEmail`'s insert values, add `html: input.html ?? null,`.

Add the pure mapper + use it in `drainOutbox` (replace the inline `{ to, subject, text }` object):

```ts
/** Map a stored outbox row to the email seam (NTF-03). Pure. Sends multipart when html is present. */
export function rowToEmailMessage(row: { toAddress: string; subject: string; body: string; html: string | null; kind: string }) {
  return {
    to: row.toAddress,
    subject: row.subject,
    text: row.body,
    ...(row.html ? { html: row.html } : {}),
    meta: { kind: row.kind },
  };
}
```

In `drainOutbox`, replace:

```ts
      const { id } = await sendEmail(
        { to: row.toAddress, subject: row.subject, text: row.body, meta: { kind: row.kind } },
        transport,
      );
```

with:

```ts
      const { id } = await sendEmail(rowToEmailMessage(row), transport);
```

In `enqueueRunDigests` — add the partner color to the select and thread it through:
- Add `pColor: schema.partners.color,` to the `.select({...})` on the leads/partners join.
- In the `Group` interface add `color: string | null;` and in the grouping default add `color: r.pColor`.
- In `buildPartnerDigest({...})` add `partnerRef: g.ref, partnerColor: g.color ?? undefined,`.
- In the partner digest `enqueueEmail({...})` add `html: c.html,`.
- Build the admin summary with the import URL and enqueue its html:

```ts
  const summary = buildAdminRunSummary({
    appName: APP_NAME,
    uploadRef: input.uploadRef,
    summary: input.summary,
    importUrl: `${input.portalBaseUrl}/imports/${input.uploadRef}`,
  });
```
  and in its `enqueueEmail({...})` add `html: summary.html,`.

In `notifyStatusChange` — brand the admin alert email. Replace its `enqueueEmail({...})` body param usage to also pass html:

```ts
      await enqueueEmail(db, {
        tenantId: scope.tenantId,
        to: email,
        subject: title,
        body: `A partner updated lead ${input.leadRef} to "${input.status}".`,
        html: renderEmailDocument({
          title,
          preheader: title,
          contentHtml:
            `<p style="font-family:${EMAIL_FONTS.body};color:${EMAIL_COLORS.text2};font-size:15px">` +
            `A partner updated lead <strong style="color:${EMAIL_COLORS.text}">${escapeHtml(input.leadRef)}</strong> ` +
            `to "${escapeHtml(input.status)}".</p>`,
        }),
        kind: "status_change",
        meta: { leadRef: input.leadRef },
      });
```

- [ ] **Step 7: Run the pure test + typecheck + the digest/email suites**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/outbox-row.test.ts tests/unit/digests.test.ts`
Then: `pnpm typecheck`
Expected: PASS / no type errors. (If `schema.partners.color` differs in name, adjust the select — verify against `src/db/schema.ts` first.)

- [ ] **Step 8: Run the full unit suite + integration export/notify suites**

Run: `pnpm test:unit -- --no-file-parallelism`
Then: `pnpm test:integration` (local DB; serial)
Expected: all green. Investigate any red before proceeding.

---

### Task 6: Owner walkthrough — throwaway preview route (NOT committed)

**Files:**
- Create (throwaway, delete before Task 7): `src/app/gallery/emails/page.tsx`

- [ ] **Step 1: Build the preview page** rendering the REAL builders with mock data (digest,
  admin summary, invite, otp, reset) in sandboxed `<iframe srcDoc>` frames, plus an "Export legend
  proof" section that maps each `PARTNER_SWATCHES` tint to its `contrastText` ink to show AA.

```tsx
import { buildPartnerDigest, buildAdminRunSummary } from "@/modules/notify/digests";
import { buildInviteEmail, buildOtpEmail, buildResetEmail } from "@/lib/auth/notify";
import { contrastText } from "@/modules/export/render";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";

export const dynamic = "force-static";

export default function EmailGallery() {
  const digest = buildPartnerDigest({
    appName: "JV Platform", partnerName: "Summit Partners", partnerRef: "JV-091",
    portalUrl: "https://app.test/portal", uploadRef: "IM-26-044", partnerColor: "#C79A3E",
    leads: [
      { refId: "LD-26-04127", city: "Sammamish", state: "WA" },
      { refId: "LD-26-04119", city: "Issaquah", state: "WA" },
      { refId: "LD-26-04098", city: "Issaquah", state: "WA" },
    ],
  });
  const summary = buildAdminRunSummary({
    appName: "JV Platform", uploadRef: "IM-26-044", importUrl: "https://app.test/imports/IM-26-044",
    summary: { total: 512, kept: 412, removed: 64, unmatched: 36, previouslyMatched: 11, perPartner: [{ partnerId: "p1", count: 412 }] },
  });
  const frames: [string, string][] = [
    ["Partner digest", digest.html],
    ["Admin run summary", summary.html],
    ["Invite", buildInviteEmail("sarah@summit.test", "https://app.test/invite/abc").html!],
    ["OTP", buildOtpEmail("sarah@summit.test", "421903").html!],
    ["Password reset", buildResetEmail("sarah@summit.test", "https://app.test/reset/xyz").html!],
  ];
  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      {frames.map(([label, html]) => (
        <section key={label}>
          <h2 style={{ fontFamily: "sans-serif" }}>{label}</h2>
          <iframe title={label} srcDoc={html} style={{ width: "100%", maxWidth: 680, height: 620, border: "1px solid #ccc" }} />
        </section>
      ))}
      <section>
        <h2 style={{ fontFamily: "sans-serif" }}>Export legend proof (contrastText AA)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6 }}>
          {PARTNER_SWATCHES.map((hex) => (
            <div key={hex} style={{ background: hex, color: "#" + contrastText(hex).slice(2), padding: "10px 12px", fontFamily: "monospace", borderRadius: 6 }}>
              {hex} · JV-000
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Serve + screenshot** — `preview_start` name `web` (port 3000); navigate to
  `http://localhost:3000/gallery/emails`; Playwright screenshot the digest + invite + otp frames and
  the export proof grid. Confirm: branded chrome, refId+location (no addresses), name+JV-ref, AA text
  on every swatch, no console errors beyond the benign dev eval/CSP + `/api/notifications` 401.

- [ ] **Step 3: Present screenshots to the owner; get the go-ahead.**

- [ ] **Step 4: DELETE the throwaway route** — `rm src/app/gallery/emails/page.tsx` (dir too if empty).
  Confirm `git status` shows no `gallery/emails` artifact before committing.

---

### Task 7: Self-audit + single WP-G commit

- [ ] **Step 1: PLAYBOOK §6 self-audit** — run the checklist in `docs/PLAYBOOK.md §6`; print the
  filled checklist in the summary.

- [ ] **Step 2: Review agents on the diff** — dispatch in parallel: `pr-reviewer`,
  `audit-design-system`, `audit-a11y` (email contrast/semantics, export AA), `audit-security`
  (SEC-05/06/07 unchanged, no XSS in the email HTML). Triage + fix findings.

- [ ] **Step 3: Final green gate**

Run: `pnpm typecheck`
Then: `pnpm test:unit -- --no-file-parallelism`
Then: lint the changed files only (repo-wide lint has pre-existing errors):
`pnpm exec eslint src/modules/notify/email-template.ts src/modules/notify/digests.ts src/modules/notify/outbox.ts src/lib/auth/notify.ts src/modules/export/render.ts`
Expected: all green.

- [ ] **Step 4: Single WP-G commit** (includes the spec + this plan, per the one-commit rule)

```bash
git add -A
git commit -m "feat(wp-g): Survey email + export brand surfaces (mockups 11+12)"
```

Commit body should note: shared inline-HTML email shell (all partner-facing emails), nullable
`email_outbox.html` column (migration 0016), and the WCAG max-contrast `contrastText` export fix
(no golden re-pin — no export-bytes golden; determinism is semantic).

---

## Self-Review (against the spec)

- **Spec §3.1 shell** → Task 2. **§3.2 fidelity** (table/inline/light-only/fallback fonts) → Task 2
  shell. **§3.3 digest/admin/auth templates** → Tasks 3 + 4. **§3.4 wiring + migration** → Task 5.
- **Spec §4 export fix + legend cell + determinism note** → Task 1 (+ commit body Task 7).
- **Spec §5 tests** → each build task is test-first; export AA (Task 1), shell (Task 2), digest
  SEC-05/PRN-14/escaping (Task 3), auth text-contract (Task 4), drain mapper (Task 5).
- **Spec §6 walkthrough** → Task 6. **§7 audits** → Task 7.
- **Placeholder scan:** none — every code step carries full code. The one prose note (OTP expiry
  copy in Task 4) resolves to a concrete `paragraphs`/`code` form.
- **Type consistency:** `contrastText` returns `"FF000000"|"FFFFFFFF"` (Tasks 1, 6); `DigestContent`
  gains `html: string` used by Tasks 3/5; `rowToEmailMessage` signature matches Tasks 5's usage;
  `PartnerDigestInput.partnerRef` (required) is added to the existing test input in Task 3 Step 1.
- **Known risk:** `schema.partners.color` column name — Task 5 Step 7 says verify against schema
  before relying on it (the export already reads a partner `color`, so it exists; confirm the field
  name in Drizzle).
