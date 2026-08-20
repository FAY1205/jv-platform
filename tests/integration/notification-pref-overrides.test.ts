import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";
import { enqueueRunDigests, notifyStatusChange, notifyLeadAssigned } from "@/modules/notify/outbox";
import { NOTIFICATION_EVENTS } from "@/modules/notify/prefs";
import {
  ensureSubjectToken,
  loadOverridesFor,
  loadPartnerOverride,
  loadPartnerOverridesFor,
  saveSubjectOverride,
  type PrefOverrideValue,
} from "@/modules/notify/pref-overrides";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import type { RunSummary } from "@/modules/analytics/run-summary";

// WP-NF2 PR A. The overlay is a SECOND scoping axis on top of the tenant one — a per-seat row
// that decides whether a person is emailed — so its tenancy legs (TST-01c) and its gating in
// BOTH directions are pinned here against the real database, not a stub. The unsubscribe
// endpoint is driven as a real handler because its whole contract is an HTTP-level one
// (AUT-05: one envelope for every outcome).
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { POST as postUnsubscribe } from "@/app/api/unsubscribe/route";
import { GET as getMyPrefs, PUT as putMyPrefs } from "@/app/api/me/notification-prefs/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
// Slugs are UNIQUE PER RUN (the `test-scp03-alpha-*` precedent). A fixed slug makes this
// suite's `cleanup()` — which resolves tenants BY SLUG and then deletes their users — a
// cross-process weapon: two runs against the same test project (two sessions, or a local run
// racing CI) each delete the other's tenants mid-flight, producing FK violations on `users`
// and 403s from routes whose seat has just been removed underneath them. The suffix scopes
// every setup and every cleanup to this process's own rows. Nothing else changes: cleanup
// still matches by slug, it just cannot match anyone else's.
const RUN = randomUUID().slice(0, 8);
const SLUG_A = `test-nf2-overrides-a-${RUN}`;
const SLUG_B = `test-nf2-overrides-b-${RUN}`;

const overrides = schema.notificationPrefOverrides;

/**
 * The catalog keys a role bucket owns, DERIVED rather than frozen as a literal.
 *
 * These assertions used to spell the list out, which made every future catalog addition break
 * three tests that are not about the catalog at all (WP-NF2 PR B's four new types did exactly
 * that). What each of them actually claims is a BUCKET claim — "this caller sees their own
 * bucket and not the other one" — so the list is derived and the anti-leak half is asserted
 * separately and explicitly below, where it cannot be satisfied by the derivation.
 */
const bucketKeys = (role: "admin" | "partner") =>
  NOTIFICATION_EVENTS.filter((e) => e.role === role).map((e) => e.key);
const summary: RunSummary = { total: 2, kept: 2, removed: 0, unmatched: 0, perPartner: [] };

suite("WP-NF2 PR A: per-subject prefs + tokenized unsubscribe", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};

  const adminScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.admin });
  const partnerScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "partner", userId: id.seat, partnerId: id.partner });
  const otherScope = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.strangerAdmin });

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [overrides, schema.notifications, schema.emailOutbox, schema.settings, schema.leads, schema.uploads]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.tenantId, tids));
    if (users.length > 0) {
      await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, users.map((u) => u.id)));
    }
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  /** Wipe every overlay row + fan-out artefact so each test starts from "no overlay anywhere". */
  async function resetState() {
    for (const tbl of [overrides, schema.notifications, schema.emailOutbox]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, [id.tenantA, id.tenantB]));
    }
  }

  const outboxRows = (tenantId = id.tenantA) =>
    db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, tenantId));
  const notificationRows = (userId: string) =>
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

  const runDigests = () =>
    enqueueRunDigests(db, adminScope(), {
      uploadRef: "IM-26-900",
      summary,
      portalBaseUrl: "https://app.test",
      adminEmails: ["admin@nf2.test", "ops-mailbox@nf2.test"],
      adminUserId: id.admin,
    });

  beforeAll(async () => {
    db = getDb();
    await cleanup();

    const [a] = await db.insert(schema.tenants).values({ name: "NF2 A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [b] = await db.insert(schema.tenants).values({ name: "NF2 B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantA = a.id;
    id.tenantB = b.id;

    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId: a.id, refId: "JV-001", name: "Alpha", email: "alpha-org@nf2.test", color: "#f4c95d", status: "active" })
      .returning({ id: schema.partners.id });
    const [pb] = await db
      .insert(schema.partners)
      .values({ tenantId: b.id, refId: "JV-001", name: "Beta", email: "beta-org@nf2.test", color: "#b9c4d6", status: "active" })
      .returning({ id: schema.partners.id });
    id.partner = p.id;
    id.partnerB = pb.id;

    id.admin = randomUUID();
    id.admin2 = randomUUID();
    id.seat = randomUUID();
    id.seat2 = randomUUID();
    id.strangerAdmin = randomUUID();
    id.member = randomUUID();
    // EXPLICIT, DISTINCT createdAt values. The "oldest seat wins a shared mailbox" rule is
    // resolved by (created_at, id), so leaving these to default to the same now() would make
    // every ordering assertion below a UUID coin-flip that passes ~half the time. The
    // same-address stranger in tenant B is seeded OLDEST of all, so any cross-tenant leak in
    // the resolver would deterministically win the tie and be caught, rather than being caught
    // only when the random ids happened to sort the right way.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    await db.insert(schema.users).values([
      { id: id.strangerAdmin, tenantId: b.id, email: "admin@nf2.test", role: "admin", createdAt: at(0) },
      { id: id.admin, tenantId: a.id, email: "admin@nf2.test", role: "admin", createdAt: at(10) },
      { id: id.admin2, tenantId: a.id, email: "admin2@nf2.test", role: "admin", createdAt: at(20) },
      { id: id.member, tenantId: a.id, email: "member@nf2.test", role: "member", createdAt: at(30) },
      { id: id.seat, tenantId: a.id, email: "seat@nf2.test", role: "partner", partnerId: p.id, createdAt: at(40) },
      { id: id.seat2, tenantId: a.id, email: "seat2@nf2.test", role: "partner", partnerId: p.id, createdAt: at(50) },
    ]);
    // The partner seat's ToS acceptance — /api/me/notification-prefs shares the sibling routes'
    // LGL-01 gate, and a partner with no record is refused before the handler body runs.
    await db.insert(schema.tosAcceptances).values({ userId: id.seat, version: CURRENT_TOS_VERSION });

    const [up] = await db
      .insert(schema.uploads)
      .values({ tenantId: a.id, refId: "IM-26-900", filename: "w.xlsx", status: "processed" })
      .returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values([
      { tenantId: a.id, refId: "LD-26-90001", uploadId: up.id, dedupeKey: "nf2-1|75001", rawJson: {}, partnerId: p.id, city: "Austin", state: "TX", mlsStatus: "kept", scoreGroup: "hot", scoreTotal: 42 },
      { tenantId: a.id, refId: "LD-26-90002", uploadId: up.id, dedupeKey: "nf2-2|75002", rawJson: {}, partnerId: p.id, city: "Dallas", state: "TX", mlsStatus: "kept" },
    ]);
  });

  beforeEach(async () => {
    await resetState();
    setRouteScope(null);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ── Token minting + tenancy (TST-01c) ──────────────────────────────────────

  it("NTF-13: ensureSubjectToken get-or-creates ONE row per subject and returns a stable token", async () => {
    const first = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    const second = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    expect(second.token).toBe(first.token);
    const [tokenId, secret] = first.token.split(".");
    expect(tokenId).toHaveLength(24); // 18 bytes, base64url unpadded — >= the scrubber's 24-char rule
    expect(secret).toHaveLength(43); // 32 bytes, base64url unpadded
    const rows = await db.select().from(overrides).where(and(eq(overrides.tenantId, id.tenantA), eq(overrides.userId, id.admin)));
    expect(rows).toHaveLength(1);
    expect(rows[0].partnerId).toBeNull();
    expect(rows[0].value).toEqual({});
  });

  it("NTF-13: a USER subject and a PARTNER subject get DIFFERENT rows and different tokens", async () => {
    const seatToken = await ensureSubjectToken(db, id.tenantA, { userId: id.seat });
    const orgToken = await ensureSubjectToken(db, id.tenantA, { partnerId: id.partner });
    expect(orgToken.token).not.toBe(seatToken.token);
    const rows = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.userId !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.partnerId !== null)).toHaveLength(1);
  });

  it("TST-01c: loadOverridesFor NEVER returns another tenant's row for the same user id", async () => {
    await saveSubjectOverride(db, id.tenantA, { userId: id.admin }, { allEmailsOff: true });
    expect(await loadOverridesFor(db, id.tenantA, [id.admin])).toEqual(new Map([[id.admin, { allEmailsOff: true }]]));
    // The SAME user id, read under the other tenant: nothing.
    expect((await loadOverridesFor(db, id.tenantB, [id.admin])).size).toBe(0);
    expect((await loadOverridesFor(db, id.tenantA, [])).size).toBe(0);
  });

  it("TST-01c: partner-org overlay loads are tenant-pinned too", async () => {
    await saveSubjectOverride(db, id.tenantA, { partnerId: id.partner }, { allEmailsOff: true });
    expect(await loadPartnerOverride(db, id.tenantA, id.partner)).toEqual({ allEmailsOff: true });
    expect(await loadPartnerOverride(db, id.tenantB, id.partner)).toBeNull();
    expect((await loadPartnerOverridesFor(db, id.tenantB, [id.partner])).size).toBe(0);
    expect((await loadPartnerOverridesFor(db, id.tenantA, [id.partner])).size).toBe(1);
  });

  // ── Gating, both directions ────────────────────────────────────────────────

  it("NTF-10: with NO overlay row anywhere, a run fans out exactly as before", async () => {
    const n = await runDigests();
    // partner digest + partner hot alert (org address) + 2 admin summaries + 2 admin hot alerts
    expect(n).toBe(6);
    const kinds = (await outboxRows()).map((r) => r.kind).sort();
    expect(kinds).toEqual(["admin_run_summary", "admin_run_summary", "hot_leads", "hot_leads", "hot_leads", "partner_digest"]);
    expect(await notificationRows(id.seat)).toHaveLength(2); // new_leads + hot_leads
  });

  it("NTF-10: overlay email-off suppresses the enqueue but KEEPS the in-app row", async () => {
    await saveSubjectOverride(db, id.tenantA, { partnerId: id.partner }, { events: { new_leads: { email: false } } });
    await runDigests();
    const kinds = (await outboxRows()).map((r) => r.kind);
    expect(kinds).not.toContain("partner_digest");
    const rows = await notificationRows(id.seat);
    expect(rows.map((r) => r.type).sort()).toEqual(["hot_leads", "new_leads"]);
  });

  it("NTF-10: overlay in-app-off suppresses the bell row but KEEPS the email", async () => {
    await saveSubjectOverride(db, id.tenantA, { userId: id.seat }, { events: { new_leads: { inApp: false }, hot_leads: { inApp: false } } });
    await runDigests();
    expect(await notificationRows(id.seat)).toHaveLength(0);
    // The seat's colleague is untouched, and the ORG-addressed digest still goes out.
    expect(await notificationRows(id.seat2)).toHaveLength(2);
    expect((await outboxRows()).map((r) => r.kind)).toContain("partner_digest");
  });

  it("NTF-10: allEmailsOff suppresses EVERY kind, including the org-addressed digests", async () => {
    await saveSubjectOverride(db, id.tenantA, { partnerId: id.partner }, { allEmailsOff: true });
    await saveSubjectOverride(db, id.tenantA, { userId: id.admin }, { allEmailsOff: true });
    await runDigests();
    const kinds = (await outboxRows()).map((r) => r.kind).sort();
    // Only the env-allowlist ops mailbox (no seat, no overlay) is left: summary + hot alert.
    expect(kinds).toEqual(["admin_run_summary", "hot_leads"]);
    expect((await outboxRows()).every((r) => r.toAddress === "ops-mailbox@nf2.test")).toBe(true);
    // In-app is untouched by an email kill switch (§10.7).
    expect(await notificationRows(id.seat)).toHaveLength(2);
    expect(await notificationRows(id.admin)).toHaveLength(2);
  });

  it("NTF-14: a seat-addressed email carries THAT seat's unsubscribe links; an unresolved ops address carries none", async () => {
    await runDigests();
    const rows = await outboxRows();
    const mine = rows.find((r) => r.toAddress === "admin@nf2.test" && r.kind === "admin_run_summary")!;
    const ops = rows.find((r) => r.toAddress === "ops-mailbox@nf2.test" && r.kind === "admin_run_summary")!;
    const [{ tokenId }] = await db
      .select({ tokenId: overrides.tokenId })
      .from(overrides)
      .where(and(eq(overrides.tenantId, id.tenantA), eq(overrides.userId, id.admin)));
    expect(mine.html).toContain(tokenId);
    expect(mine.html).toContain("Stop all notification emails");
    // §10.3: an env-configured ops mailbox is not a subject, so there is nothing to unsubscribe.
    expect(ops.html).not.toContain("Unsubscribe");
  });

  it("TST-01c: allowlist resolution never mints for a same-address user in ANOTHER tenant", async () => {
    // `strangerAdmin` (tenant B) shares "admin@nf2.test" with tenant A's admin AND is the oldest
    // such row overall, so a resolver missing its tenant pin would deterministically pick it.
    await runDigests();
    const rows = await db.select().from(overrides);
    const tenantAUsers = new Set([id.admin, id.admin2, id.member, id.seat, id.seat2]);
    const userRows = rows.filter((r) => r.userId !== null);
    expect(userRows.length).toBeGreaterThan(0); // non-vacuous
    for (const r of userRows) {
      expect(tenantAUsers.has(r.userId!), `minted for an unexpected user ${r.userId}`).toBe(true);
      expect(r.tenantId).toBe(id.tenantA);
    }
    expect(rows.some((r) => r.userId === id.strangerAdmin)).toBe(false);
    expect(rows.filter((r) => r.tenantId === id.tenantB)).toHaveLength(0);
  });

  it("TST-01c: ensureSubjectToken refuses a subject from another tenant", async () => {
    // The ONE statement that CREATES a capability. A mismatched (tenant, subject) pair must not
    // mint a row claiming tenant A while pointing at tenant B's seat — there is no RLS backstop.
    await expect(ensureSubjectToken(db, id.tenantA, { userId: id.strangerAdmin })).rejects.toThrow(/outside this tenant/);
    await expect(ensureSubjectToken(db, id.tenantB, { partnerId: id.partner })).rejects.toThrow(/outside this tenant/);
    expect(await db.select().from(overrides)).toHaveLength(0); // nothing written on either path
  });

  it("NTF-13: two concurrent ensureSubjectToken calls for the same subject mint exactly one row/token", async () => {
    // The partial unique index is the arbiter; the loser re-reads the winner's row. A subject's
    // token must never change, or links already sitting in an inbox would stop working.
    const [a, b, c] = await Promise.all([
      ensureSubjectToken(db, id.tenantA, { userId: id.admin }),
      ensureSubjectToken(db, id.tenantA, { userId: id.admin }),
      ensureSubjectToken(db, id.tenantA, { userId: id.admin }),
    ]);
    expect(b.token).toBe(a.token);
    expect(c.token).toBe(a.token);
    const rows = await db.select().from(overrides).where(and(eq(overrides.tenantId, id.tenantA), eq(overrides.userId, id.admin)));
    expect(rows).toHaveLength(1);
  });

  it("NTF-14: an ORG-addressed digest carries the PARTNER token, not a seat's", async () => {
    await runDigests();
    const digest = (await outboxRows()).find((r) => r.kind === "partner_digest")!;
    const rows = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA));
    const org = rows.find((r) => r.partnerId === id.partner)!;
    expect(digest.html).toContain(org.tokenId);
    for (const seatRow of rows.filter((r) => r.userId !== null)) {
      expect(digest.html).not.toContain(seatRow.tokenId);
    }
  });

  it("NTF-10/NTF-14: notifyStatusChange emails PER SEAT, each with its own token", async () => {
    // WP-NF2b: status_change email defaults OFF and there is no workspace matrix to switch it
    // on, so BOTH seats opt themselves in — which is also the stronger setup: two independent
    // overlays proving the emit resolved each recipient separately.
    for (const userId of [id.admin, id.admin2]) {
      await saveSubjectOverride(db, id.tenantA, { userId }, { events: { status_change: { email: true, inApp: true } } });
    }
    await notifyStatusChange(db, adminScope(), { leadRef: "LD-26-90001", status: "contacted" });
    const rows = (await outboxRows()).filter((r) => r.kind === "status_change");
    expect(rows.map((r) => r.toAddress).sort()).toEqual(["admin2@nf2.test", "admin@nf2.test"]);
    const tokens = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA));
    for (const userId of [id.admin, id.admin2]) {
      const row = rows.find((r) => r.toAddress === (userId === id.admin ? "admin@nf2.test" : "admin2@nf2.test"))!;
      expect(row.html).toContain(tokens.find((t) => t.userId === userId)!.tokenId);
    }
  });

  it("NTF-10: a partner seat can OPT IN to an email the shipped default has off", async () => {
    // assigned_lead defaults { email: false, inApp: true }.
    await notifyLeadAssigned(db, adminScope(), { leadRef: "LD-26-90001", partnerId: id.partner });
    expect((await outboxRows()).filter((r) => r.kind === "assigned_lead")).toHaveLength(0);
    await saveSubjectOverride(db, id.tenantA, { userId: id.seat }, { events: { assigned_lead: { email: true } } });
    await notifyLeadAssigned(db, adminScope(), { leadRef: "LD-26-90001", partnerId: id.partner });
    const sent = (await outboxRows()).filter((r) => r.kind === "assigned_lead");
    expect(sent.map((r) => r.toAddress)).toEqual(["seat@nf2.test"]); // NOT seat2, who never opted in
  });

  // ── The unsubscribe endpoint (AUT-05) ──────────────────────────────────────

  const unsubscribe = async (body: unknown) => postUnsubscribe(jsonRequest("POST", "/api/unsubscribe", body));
  const valueFor = async (where: ReturnType<typeof eq>): Promise<PrefOverrideValue> => {
    const [row] = await db.select({ value: overrides.value }).from(overrides).where(where);
    return row.value as PrefOverrideValue;
  };

  it("NTF-13: a valid token switches off that ONE event's email, and only that", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    const res = await unsubscribe({ token, event: "run_summary" });
    expect(res.status).toBe(200);
    expect(await valueFor(eq(overrides.userId, id.admin))).toEqual({ events: { run_summary: { email: false } } });
  });

  it("NTF-13: re-applying the same unsubscribe is idempotent", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    await unsubscribe({ token, event: "all" });
    const [after] = await db.select().from(overrides).where(eq(overrides.userId, id.admin));
    await unsubscribe({ token, event: "all" });
    const [again] = await db.select().from(overrides).where(eq(overrides.userId, id.admin));
    expect(again.value).toEqual({ allEmailsOff: true });
    expect(again.updatedAt.getTime()).toBe(after.updatedAt.getTime()); // no second write
  });

  it("NTF-13: an unknown-but-well-formed event key succeeds and writes nothing", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    const res = await unsubscribe({ token, event: "not_an_event" });
    expect(res.status).toBe(200);
    expect(await valueFor(eq(overrides.userId, id.admin))).toEqual({});
  });

  it("NTF-13/AUT-05: valid, wrong-secret, unknown-id and malformed tokens return the SAME envelope", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    const [tokenId] = token.split(".");
    const bodies = await Promise.all(
      [
        token,
        `${tokenId}.${"z".repeat(43)}`, // right id, wrong secret
        `${"q".repeat(22)}.${"z".repeat(43)}`, // no such id
        "not-a-token",
        ".",
      ].map(async (t) => {
        const res = await unsubscribe({ token: t, event: "all" });
        return { status: res.status, body: await res.json() };
      }),
    );
    for (const b of bodies) {
      expect(b.status).toBe(200);
      expect(b.body).toEqual(bodies[0].body);
      expect(JSON.stringify(b.body)).not.toContain("@"); // never echoes an address
    }
  });

  it("NTF-13: a wrong secret leaves the subject's value untouched", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.admin });
    const [tokenId] = token.split(".");
    await unsubscribe({ token: `${tokenId}.${"z".repeat(43)}`, event: "all" });
    expect(await valueFor(eq(overrides.userId, id.admin))).toEqual({});
  });

  it("NTF-13: a PARTNER token gates the ORG address; a USER token gates the seat", async () => {
    const org = await ensureSubjectToken(db, id.tenantA, { partnerId: id.partner });
    await unsubscribe({ token: org.token, event: "all" });
    await runDigests();
    const addresses = (await outboxRows()).map((r) => r.toAddress);
    expect(addresses).not.toContain("alpha-org@nf2.test");
    expect(addresses).toContain("admin@nf2.test"); // the seat subject was never touched
    // ...and the org unsubscribe never created or altered a USER row.
    const userRows = await db.select().from(overrides).where(and(eq(overrides.tenantId, id.tenantA), eq(overrides.userId, id.seat)));
    expect(userRows.every((r) => Object.keys(r.value as object).length === 0)).toBe(true);
  });

  it("NTF-13: unsubscribing never touches the in-app channel", async () => {
    const { token } = await ensureSubjectToken(db, id.tenantA, { userId: id.seat });
    await unsubscribe({ token, event: "all" });
    await runDigests();
    expect(await notificationRows(id.seat)).toHaveLength(2);
  });

  it("NTF-13: a body that is not a {token,event} pair is rejected as malformed input", async () => {
    expect((await unsubscribe({})).status).toBe(400);
    expect((await unsubscribe({ token: "a.b" })).status).toBe(400);
    expect((await unsubscribe(null)).status).toBe(400);
  });

  // ── Self-serve preferences (NTF-15) ────────────────────────────────────────

  it("NTF-15: GET returns the CALLER'S role bucket with effective + overridden legs", async () => {
    setRouteScope(adminScope());
    const body = (await (await getMyPrefs()).json()) as {
      role: string;
      allEmailsOff: boolean;
      events: { key: string; effective: { email: boolean; inApp: boolean }; overridden: { email: boolean; inApp: boolean } }[];
    };
    expect(body.role).toBe("admin");
    expect(body.allEmailsOff).toBe(false);
    expect(body.events.map((e) => e.key)).toEqual(bucketKeys("admin"));
    // The claim the derived list cannot make on its own: a partner-only key never appears.
    expect(body.events.map((e) => e.key)).not.toContain("new_leads");
    expect(body.events.every((e) => e.overridden.email === false && e.overridden.inApp === false)).toBe(true);
  });

  it("NTF-15: PUT upserts the CALLER'S OWN row and returns the refreshed view", async () => {
    setRouteScope(adminScope());
    const res = await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { events: { run_summary: { email: false } }, allEmailsOff: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { key: string; effective: { email: boolean }; overridden: { email: boolean } }[] };
    const row = body.events.find((e) => e.key === "run_summary")!;
    expect(row.effective.email).toBe(false);
    expect(row.overridden.email).toBe(true);
    // Exactly one row, owned by the caller — and the write reached the database.
    const stored = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA));
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe(id.admin);
    expect(stored[0].value).toEqual({ events: { run_summary: { email: false } }, allEmailsOff: false });
  });

  it("NTF-15: a PARTNER caller sees the partner bucket, never the admin one", async () => {
    setRouteScope(partnerScope());
    const body = (await (await getMyPrefs()).json()) as { role: string; events: { key: string }[] };
    expect(body.role).toBe("partner");
    expect(body.events.map((e) => e.key)).toEqual(bucketKeys("partner"));
    // The anti-leak half, stated directly: admin-ONLY ops keys are never offered to a partner
    // (WP-NF2 §10.4 — partner_note/import_result/partner_activated have no partner bucket).
    for (const adminOnly of ["run_summary", "status_change", "partner_note", "import_result", "partner_activated"]) {
      expect(body.events.map((e) => e.key)).not.toContain(adminOnly);
    }
  });

  it("NTF-15: a member seat reads the ADMIN bucket", async () => {
    // Phase C: preference buckets are per-STREAM, not per-tier — member/viewer are admin-stream.
    setRouteScope({ tenantId: id.tenantA, role: "member", userId: id.member });
    const body = (await (await getMyPrefs()).json()) as { role: string; events: { key: string }[] };
    expect(body.role).toBe("admin");
    expect(body.events.map((e) => e.key)).toEqual(bucketKeys("admin"));
    expect(body.events.map((e) => e.key)).not.toContain("new_leads");
  });

  it("NTF-15: a partner PUT cannot store an admin-bucket event key", async () => {
    setRouteScope(partnerScope());
    const res = await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { events: { run_summary: { email: false } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA))).toHaveLength(0);
    // The partner's OWN bucket keys still save.
    expect((await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { events: { new_leads: { email: false } } }))).status).toBe(200);
  });

  it("TST-01c: a partner PUT writes the SEAT row, never the partner-ORG row", async () => {
    // A partner caller has both a userId and a partnerId in scope. The self-serve surface is the
    // SEAT's; the org row gates partners.email and is not this endpoint's to touch.
    setRouteScope(partnerScope());
    expect((await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { allEmailsOff: true }))).status).toBe(200);
    const rows = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(id.seat);
    expect(rows[0].partnerId).toBeNull();
  });

  it("NTF-15: PUT rejects an invalid overlay shape", async () => {
    setRouteScope(adminScope());
    const res = await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { events: { not_an_event: { email: false } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA))).toHaveLength(0);
  });

  it("NTF-15: an unauthenticated caller is refused, and CSRF is enforced on PUT", async () => {
    setRouteScope(null);
    expect((await getMyPrefs()).status).toBe(401);
    setRouteScope(adminScope());
    const bare = new Request("http://localhost:3000/api/me/notification-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect((await putMyPrefs(bare)).status).toBe(403);
  });

  it("TST-01c: a PUT can never write another tenant's or another user's row", async () => {
    setRouteScope(otherScope());
    // Tenant B's admin shares tenant A's admin EMAIL — identity comes from the scope alone.
    await putMyPrefs(jsonRequest("PUT", "/api/me/notification-prefs", { allEmailsOff: true }));
    expect(await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantA))).toHaveLength(0);
    const b = await db.select().from(overrides).where(eq(overrides.tenantId, id.tenantB));
    expect(b).toHaveLength(1);
    expect(b[0].userId).toBe(id.strangerAdmin);
  });
});
