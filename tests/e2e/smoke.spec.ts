import { test, expect } from "@playwright/test";

// Unauthenticated smoke — runs on every main e2e job against the built + served app
// (Postgres migrated). No Supabase Auth needed, so these are stable regardless of the
// TST-07 auth-infra gate.

// WP-001: the home page renders and identifies the product. Since N3C-07/C-63
// (PR #142) the auth-card <h1> is the screen's PURPOSE ("Sign in") and the product
// name is the AuthCardHeader's eyebrow line — so the identity assertion targets
// visible text, not a heading role, and the purpose heading is pinned alongside it.
test("home page renders the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TerritoryDesk/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /sign.in/i })).toBeVisible();
});

// F-07: the liveness heartbeat answers without auth or DB.
test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

// PTL-01: the partner portal sign-in renders its email step (after the silent
// trusted-device check falls through to OTP).
test("portal login renders the sign-in form", async ({ page }) => {
  await page.goto("/portal/login");
  await expect(page.getByRole("button", { name: /send code/i })).toBeVisible();
});

// PRN-08 self-guard: a portal data route with no session must NOT serve data.
test("an unauthenticated portal data route is refused", async ({ request }) => {
  const res = await request.get("/api/portal/leads");
  expect(res.ok()).toBeFalsy(); // 401/403 uniform refusal, never a 200 with data
  const body = (await res.json().catch(() => ({}))) as { code?: string; leads?: unknown };
  expect(body.leads).toBeUndefined();
  expect(typeof body.code).toBe("string");
});
