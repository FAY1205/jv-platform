import { test, expect, type APIRequestContext } from "@playwright/test";

// TST-07: the full partner journey — sign-in via OTP (dev mailbox) → ToS accept →
// leads → status update → note → export.
//
// This drives REAL auth, so it needs a dev Supabase Auth project + its dev-mailbox OTP
// sink (SEC-07) + a seeded tenant/partner/leads wired into CI — an owner reality-gate
// item (WS-10). Until that infra is provisioned it self-skips; set E2E_AUTH_READY=1
// (plus E2E_PARTNER_EMAIL for the seeded partner) to activate. The steps are authored
// against the real routes/pages so activation is providing the environment + seed, not
// rewriting the test; selectors should be confirmed on the first live run.
const AUTH_READY = !!process.env.E2E_AUTH_READY;

test.describe("TST-07: partner portal journey", () => {
  test.skip(!AUTH_READY, "needs a dev Supabase Auth project + dev-mailbox OTP + seeded tenant (owner reality-gate)");

  const partnerEmail = process.env.E2E_PARTNER_EMAIL ?? "e2e-partner@example.test";

  test("OTP sign-in → ToS → leads → status → note → export", async ({ page, request }) => {
    // 1. Request an OTP for the seeded partner (PTL-01).
    await page.goto("/portal/login");
    await page.getByLabel(/email/i).fill(partnerEmail);
    await page.getByRole("button", { name: /send code/i }).click();

    // 2. Retrieve the code from the dev mailbox sink (SEC-07 — non-prod never emails).
    const code = await readLatestOtp(request, partnerEmail);
    await page.getByLabel(/6-digit code/i).fill(code);
    await page.getByRole("button", { name: /verify.*sign in/i }).click();

    // 3. First sign-in lands on the ToS gate (LGL-01 / F-04); accept it.
    await expect(page).toHaveURL(/\/portal\/tos/);
    await page.getByRole("button", { name: /accept/i }).click();

    // 4. Leads list (PTL-02): the partner sees their own leads.
    await expect(page).toHaveURL(/\/portal(\/leads)?\/?$/);
    const firstLead = page.getByRole("row").nth(1);
    await expect(firstLead).toBeVisible();

    // 5. Open the lead and update its status (PTL-03).
    await firstLead.click();
    await page.getByRole("button", { name: /contacted/i }).click();
    await expect(page.getByText(/contacted/i)).toBeVisible();

    // 6. Add a partner note (PRN-13 keeps it partner-visible only).
    await page.getByLabel(/note/i).fill("Called the seller — following up.");
    await page.getByRole("button", { name: /add note|save/i }).click();
    await expect(page.getByText(/following up/i)).toBeVisible();

    // 7. Export (PTL-04): the download is a real .xlsx.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /export/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });
});

/** Read the newest 6-digit OTP for an address from the dev mailbox (the SEC-07 sink).
 *  The retrieval endpoint is provided with the dev Auth wiring; this expects a JSON
 *  list of sink messages at /api/dev/emails?to=<addr>, newest first. */
async function readLatestOtp(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.get(`/api/dev/emails?to=${encodeURIComponent(email)}`);
  const body = (await res.json().catch(() => ({}))) as { messages?: { body: string }[] };
  const latest = body.messages?.[0]?.body ?? "";
  const match = latest.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No 6-digit OTP found in the dev mailbox for ${email}`);
  return match[1];
}
