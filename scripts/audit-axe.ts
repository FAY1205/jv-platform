// Accessibility scan for the audit system (docs/audit/README.md — "Live-app audits").
// Scans key pages with axe-core (WCAG 2.1 A/AA tags) against a served build and
// writes a JSON report to docs/audit/raw/. Read-only with respect to the app.
//
// Usage:
//   pnpm audit:serve                # terminal 1 — build + start on :4500
//   pnpm audit:axe                  # terminal 2 — public pages only
//   AUDIT_ADMIN_EMAIL=... AUDIT_ADMIN_PASSWORD=... pnpm audit:axe   # + admin pages
//
// Env: AUDIT_BASE_URL (default http://localhost:4500). Credentials are the DEV admin
// (SEC-07: never a real credential). Portal (OTP) pages are out of scope for now —
// the a11y agent static-checks those (see .claude/agents/audit-a11y.md).

import { chromium, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.AUDIT_BASE_URL ?? "http://localhost:4500";
const ADMIN_EMAIL = process.env.AUDIT_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.AUDIT_ADMIN_PASSWORD;

const PUBLIC_PAGES = ["/login", "/portal/login", "/forgot"];
const ADMIN_PAGES = ["/runs", "/partners", "/rules", "/activity", "/settings/notifications", "/upload"];

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface PageResult {
  url: string;
  violations: Array<{
    id: string;
    impact: string | null | undefined;
    wcagTags: string[];
    help: string;
    nodes: number;
    firstTarget: string;
  }>;
  error?: string;
}

async function scan(page: Page, route: string): Promise<PageResult> {
  const url = `${BASE_URL}${route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    return {
      url: route,
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        wcagTags: v.tags.filter((t) => t.startsWith("wcag")),
        help: v.help,
        nodes: v.nodes.length,
        firstTarget: String(v.nodes[0]?.target?.[0] ?? ""),
      })),
    };
  } catch (err) {
    return { url: route, violations: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function signIn(page: Page): Promise<boolean> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30_000 });
    // getByRole (not getByLabel): the password input's show/hide toggle carries
    // aria-label="Show password", which getByLabel's substring match also hits.
    await page.getByRole("textbox", { name: "Email" }).fill(ADMIN_EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/runs**", { timeout: 20_000 });
    return true;
  } catch (err) {
    console.warn(`! Sign-in failed (${err instanceof Error ? err.message : err}) — scanning public pages only.`);
    return false;
  }
}

async function main() {
  console.log(`axe scan against ${BASE_URL} (tags: ${AXE_TAGS.join(", ")})`);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results: PageResult[] = [];

  try {
    // Reachability check first so a dead server fails with a clear message.
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch {
    console.error(`✗ ${BASE_URL} is not reachable. Start the app first: pnpm audit:serve`);
    await browser.close();
    process.exitCode = 2;
    return;
  }

  for (const route of PUBLIC_PAGES) results.push(await scan(page, route));

  const authed = await signIn(page);
  if (authed) {
    for (const route of ADMIN_PAGES) results.push(await scan(page, route));
    // Include the first run-detail page if one exists (partner-colored surfaces).
    await page.goto(`${BASE_URL}/runs`, { waitUntil: "networkidle" });
    const runHref = await page
      .locator('a[href^="/runs/UP-"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    if (runHref) results.push(await scan(page, runHref));
  } else if (!ADMIN_EMAIL) {
    console.warn("! AUDIT_ADMIN_EMAIL/PASSWORD not set — admin pages skipped.");
  }

  await browser.close();

  // Console summary (the a11y agent parses this).
  let totalViolations = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`\n✗ ${r.url} — ERROR: ${r.error}`);
      continue;
    }
    totalViolations += r.violations.length;
    console.log(`\n${r.violations.length === 0 ? "✓" : "✗"} ${r.url} — ${r.violations.length} violation(s)`);
    for (const v of r.violations) {
      console.log(`  [${v.impact ?? "n/a"}] ${v.id} (${v.wcagTags.join(",")}) ×${v.nodes} — ${v.help} — e.g. ${v.firstTarget}`);
    }
  }

  const outDir = path.join(process.cwd(), "docs", "audit", "raw");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = path.join(outDir, `axe-${stamp}.json`);
  await writeFile(outFile, JSON.stringify({ baseUrl: BASE_URL, scannedAt: new Date().toISOString(), authed, results }, null, 2));
  console.log(`\nScanned ${results.length} page(s), ${totalViolations} violation(s) total. JSON: ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
