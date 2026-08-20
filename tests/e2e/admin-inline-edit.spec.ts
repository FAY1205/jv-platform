import { test, expect } from "@playwright/test";

// N5-11 — commit-on-blur writes ONCE.
//
// WHY THIS EXISTS AS AN E2E AND NOT A UNIT TEST. `InlineField`'s Editor holds a `settled`
// latch so a session exits exactly once. Two gestures reach that exit, and only one of them
// is reproducible in jsdom:
//
//   • Esc fires the keystroke AND the blur it causes — jsdom does this, so
//     tests/unit/components/inline-field.test.tsx covers it.
//   • Enter commits, which unmounts the focused input — and a real browser fires a blur on
//     removal, which commits the same draft a SECOND time. jsdom does not fire that blur, so
//     no jsdom test can tell the latch from its absence on this path.
//
// A second commit is a second `PATCH /api/leads/:ref`: a duplicate write, and under READ
// COMMITTED a second `lead.edited` audit row — hence a duplicate "Details updated" entry on
// the timeline (N5-14). Counting the requests is the only honest check, and only a browser
// can produce the event that causes the bug. ENGINEERING_STANDARDS §8 carries this as a rule
// for the class, not just for this field.
//
// ⚠️ ACTIVATION. Like TST-07's portal journey, this drives REAL auth and so needs a dev
// Supabase Auth project (SEC-07) plus a seeded tenant with at least one lead — the same owner
// reality-gate item (WS-10). Until that lands it self-skips; set E2E_AUTH_READY=1 (plus
// E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for the seeded admin) to activate. The steps are
// authored against the real routes and roles, so activation is providing the environment and
// the seed, not rewriting the test; confirm the selectors on the first live run.
//
// NOTE: e2e runs on main only, so this cannot gate the PR that introduced the latch.
const AUTH_READY = !!process.env.E2E_AUTH_READY;

test.describe("N5-11: inline per-field editing", () => {
  test.skip(!AUTH_READY, "needs a dev Supabase Auth project + a seeded admin/tenant with leads (owner reality-gate)");

  test("Enter commits the field EXACTLY once — one PATCH, not two", async ({ page }) => {
    // 1. Sign in as the seeded admin.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();

    // 2. Open the first lead — the row click mounts the record in the SidePanel (N5-02).
    await page.goto("/leads");
    const firstRow = page.getByRole("row").nth(1);
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();

    // 3. Count the writes, not the effects: a phantom blur-on-unmount commit is invisible in
    //    the UI (same value, same optimistic paint) and visible only on the wire.
    const patches: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PATCH" && /\/api\/leads\/LD-/.test(req.url())) patches.push(req.url());
    });

    // 4. Open Phone, replace the pre-selected value, commit with Enter.
    await panel.getByRole("button", { name: /^Phone:/i }).click();
    const input = panel.getByRole("textbox", { name: "Phone" });
    await expect(input).toBeFocused();
    await input.fill("(918) 555-0170");
    await input.press("Enter");

    // The field closes and focus comes back to the rest control (N5-30) — which is also the
    // moment the input is removed, i.e. the moment the phantom blur would fire.
    await expect(panel.getByRole("textbox", { name: "Phone" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Phone:/i })).toBeFocused();

    // 5. ONE write. Waiting first, so a second request cannot simply be late.
    await expect.poll(() => patches.length, { timeout: 3_000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(patches).toHaveLength(1);

    // 6. …and therefore ONE timeline entry, which is what the duplicate would be seen as.
    await expect(panel.getByText(/Details updated: phone/i)).toHaveCount(1);
  });
});
