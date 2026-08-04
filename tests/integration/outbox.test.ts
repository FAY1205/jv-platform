import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { enqueueRunDigests, drainOutbox, releaseDueImports } from "@/modules/notify/outbox";
import { DEFAULT_NOTIFICATION_PREFS } from "@/modules/notify/prefs";
import type { EmailTransport, OutboundEmail } from "@/modules/notify/email";
import type { ScopeContext } from "@/lib/scope";
import type { RunSummary } from "@/modules/analytics/run-summary";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-outbox-wp028a";

class CountingTransport implements EmailTransport {
  sent: OutboundEmail[] = [];
  async send(email: OutboundEmail) {
    this.sent.push(email);
    return { id: `t-${this.sent.length}` };
  }
}
class FailingTransport implements EmailTransport {
  async send(): Promise<{ id: string }> {
    throw new Error("smtp down");
  }
}

suite("WP-028a: email outbox + digests (NTF-01/02/03)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let uploadRef: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  const summary: RunSummary = { total: 3, kept: 3, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [] };

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Outbox", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };

    // Partner A has an email; partner B does not.
    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", email: "alpha@partner.test", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-014", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    uploadRef = "IM-26-014";
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-26-00001", uploadId: up.id, dedupeKey: "1 a|75001", rawJson: {}, partnerId: a.id, city: "Austin", state: "TX", mlsStatus: "kept" },
      { tenantId: t.id, refId: "LD-26-00002", uploadId: up.id, dedupeKey: "2 b|75002", rawJson: {}, partnerId: a.id, city: "Dallas", state: "TX", mlsStatus: "kept" },
      { tenantId: t.id, refId: "LD-26-00003", uploadId: up.id, dedupeKey: "3 c|85001", rawJson: {}, partnerId: b.id, city: "Mesa", state: "AZ", mlsStatus: "kept" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("NTF-01/02: enqueues a digest only for partners with an email, plus the admin summary", async () => {
    const n = await enqueueRunDigests(db, scope, { uploadRef, summary, portalBaseUrl: "https://app.test", adminEmails: ["admin@dev.test"] });
    expect(n).toBe(2); // Alpha digest + admin summary (Bravo has no email → skipped)

    const rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, scope.tenantId));
    const partnerDigest = rows.find((r) => r.kind === "partner_digest")!;
    expect(partnerDigest.toAddress).toBe("alpha@partner.test");
    expect(partnerDigest.body).toContain("LD-26-00001");
    expect(partnerDigest.body).toContain("LD-26-00002");
    // WP-G/NTF-03: the branded HTML alternative is persisted in the new html column.
    expect(partnerDigest.html).toContain("<!DOCTYPE html>");
    expect(partnerDigest.html).toContain("Alpha (JV-001)");
    const adminSummary = rows.find((r) => r.kind === "admin_run_summary" && r.toAddress === "admin@dev.test")!;
    expect(adminSummary).toBeDefined();
    expect(adminSummary.html).toContain("<!DOCTYPE html>");
    // NTF-01: the partner with no email got nothing.
    expect(rows.some((r) => r.body.includes("LD-26-00003"))).toBe(false);
  });

  it("NTF-03: drain sends pending rows and marks them sent", async () => {
    const transport = new CountingTransport();
    const res = await drainOutbox(db, { tenantId: scope.tenantId, transport });
    expect(res.sent).toBe(2);
    expect(transport.sent).toHaveLength(2);
    // WP-G/NTF-03: html travels multipart through the drain (not text-only).
    expect(transport.sent.some((e) => e.html?.includes("<!DOCTYPE html>"))).toBe(true);
    const rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, scope.tenantId));
    expect(rows.every((r) => r.status === "sent" && r.providerId)).toBe(true);
  });

  it("NTF-03: a send failure schedules a retry with backoff (not a hard fail)", async () => {
    await db.insert(schema.emailOutbox).values({ tenantId: scope.tenantId, toAddress: "x@dev.test", subject: "s", body: "b", kind: "partner_digest", status: "pending" });
    const res = await drainOutbox(db, { tenantId: scope.tenantId, transport: new FailingTransport() });
    expect(res.retried).toBe(1);
    const [row] = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.tenantId, scope.tenantId), eq(schema.emailOutbox.kind, "partner_digest"), eq(schema.emailOutbox.status, "pending")));
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
    expect(row.lastError).toContain("smtp down");
  });

  it("distribution hold: releaseDueImports distributes only past-window imports (digests + distributed_at), idempotently", async () => {
    const adminUser = randomUUID();
    await db.insert(schema.users).values({ id: adminUser, tenantId: scope.tenantId, email: "admin@release.test", role: "admin" });
    const [p] = await db.insert(schema.partners).values({ tenantId: scope.tenantId, refId: "JV-003", name: "Rel", email: "rel@partner.test", color: "#cccccc", status: "active" }).returning({ id: schema.partners.id });
    const past = new Date(Date.now() - 20 * 60 * 1000); // past the 10-min hold window
    const [dueUp] = await db.insert(schema.uploads).values({ tenantId: scope.tenantId, refId: "IM-26-015", filename: "r.xlsx", status: "processed", createdAt: past }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: scope.tenantId, refId: "LD-26-00010", uploadId: dueUp.id, dedupeKey: "r|1", rawJson: {}, partnerId: p.id, city: "Reno", state: "NV", mlsStatus: "kept", createdAt: past });
    // A fresh import still WITHIN the window — must NOT release.
    const [heldUp] = await db.insert(schema.uploads).values({ tenantId: scope.tenantId, refId: "IM-26-016", filename: "h.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

    const res = await releaseDueImports(db, { tenantId: scope.tenantId, portalBaseUrl: "https://app.test" });
    expect(res.released).toBe(1); // only the past-window import

    expect((await db.select({ d: schema.uploads.distributedAt }).from(schema.uploads).where(eq(schema.uploads.id, dueUp.id)))[0].d).not.toBeNull();
    expect((await db.select({ d: schema.uploads.distributedAt }).from(schema.uploads).where(eq(schema.uploads.id, heldUp.id)))[0].d).toBeNull(); // still held
    // the released import's partner digest was enqueued
    const digests = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.tenantId, scope.tenantId), eq(schema.emailOutbox.toAddress, "rel@partner.test")));
    expect(digests.length).toBeGreaterThanOrEqual(1);

    // idempotent: a second pass releases nothing more
    expect((await releaseDueImports(db, { tenantId: scope.tenantId, portalBaseUrl: "https://app.test" })).released).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCR-12: hot-lead fan-out. Its own tenant so the exact-count assertions above stay
// unaffected. Proves the gating that only code comments otherwise guarantee: the admin
// alert (at import) covers EVERY hot kept lead incl. house-territory + unmatched; the
// partner alert (at release) reaches only non-house assigned partners; and the two
// audiences never both fire for the same lead.
// ─────────────────────────────────────────────────────────────────────────────
const HOT_SLUG = "test-outbox-hot-scr12";

suite("SCR-12: hot-lead fan-out", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  const uploadRef = "IM-26-100";
  // The hot leads we expect to surface, and the warm one that must not.
  const P_HOT = "LD-26-00101"; // assigned to a normal partner
  const HOUSE_HOT = "LD-26-00102"; // house territory → admin only
  const UNMATCHED_HOT = "LD-26-00103"; // no partner → admin only
  const P_WARM = "LD-26-00104"; // not hot → never alerts

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, HOT_SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    // The admin hot-alert case creates an in-app notification (FK → users/tenant), so it
    // must be cleared before those parents or the teardown FK-fails.
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  const summary: RunSummary = { total: 4, kept: 4, removed: 0, unmatched: 1, previouslyMatched: 0, perPartner: [] };

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Hot", slug: HOT_SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const adminUser = randomUUID();
    await db.insert(schema.users).values({ id: adminUser, tenantId: t.id, email: "admin@hot.test", role: "admin" });
    scope.userId = adminUser;

    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-010", name: "Pinnacle", email: "pinnacle@partner.test", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    // The house territory is a partner row flagged isHouse — a hot lead here is admin-only.
    const [house] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "HOUSE", name: "My Territory", isHouse: true, color: "#3A3F4B", status: "active" }).returning({ id: schema.partners.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: uploadRef, filename: "hot.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const hot = { scoreTotal: 42, scoreGroup: "hot" as const, scoreStatus: "complete" as const };
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: P_HOT, uploadId: up.id, dedupeKey: "h1|75001", rawJson: {}, partnerId: p.id, city: "Austin", state: "TX", mlsStatus: "kept", ...hot },
      { tenantId: t.id, refId: HOUSE_HOT, uploadId: up.id, dedupeKey: "h2|75002", rawJson: {}, partnerId: house.id, city: "Dallas", state: "TX", mlsStatus: "kept", ...hot },
      { tenantId: t.id, refId: UNMATCHED_HOT, uploadId: up.id, dedupeKey: "h3|85001", rawJson: {}, partnerId: null, city: "Mesa", state: "AZ", mlsStatus: "kept", ...hot },
      { tenantId: t.id, refId: P_WARM, uploadId: up.id, dedupeKey: "h4|75003", rawJson: {}, partnerId: p.id, city: "Plano", state: "TX", mlsStatus: "kept", scoreTotal: 30, scoreGroup: "warm", scoreStatus: "complete" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("SCR-12: at import (audience admin) the admin alert covers every hot kept lead incl. house + unmatched, and no partner hot alert fires", async () => {
    // prefs must be passed for the in-app channel (email fires without it; in-app is gated on prefs).
    await enqueueRunDigests(db, scope, { uploadRef, summary, portalBaseUrl: "https://app.test", adminEmails: ["admin@hot.test"], adminUserId: scope.userId, prefs: DEFAULT_NOTIFICATION_PREFS, audience: "admin" });
    const rows = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.tenantId, scope.tenantId), eq(schema.emailOutbox.kind, "hot_leads")));
    // Exactly one admin hot email (to the admin), none to the partner.
    expect(rows).toHaveLength(1);
    const adminHot = rows[0];
    expect(adminHot.toAddress).toBe("admin@hot.test");
    // Covers all three hot leads (partner-assigned, house, unmatched), not the warm one.
    expect(adminHot.body).toContain(P_HOT);
    expect(adminHot.body).toContain(HOUSE_HOT);
    expect(adminHot.body).toContain(UNMATCHED_HOT);
    expect(adminHot.body).not.toContain(P_WARM);
    // The deep link routes to the hot-filtered list.
    expect(adminHot.html).toContain("https://app.test/leads?hot=1");
    // An in-app admin hot notification was created too.
    const notif = await db.select().from(schema.notifications).where(and(eq(schema.notifications.tenantId, scope.tenantId), eq(schema.notifications.type, "hot_leads")));
    expect(notif.some((n) => n.userId === scope.userId)).toBe(true);
  });

  it("SCR-12: at release (audience partner) only the non-house assigned partner is alerted, with only their own hot lead", async () => {
    // Clear the admin hot rows from the previous case so this asserts the partner path alone.
    await db.delete(schema.emailOutbox).where(and(eq(schema.emailOutbox.tenantId, scope.tenantId), eq(schema.emailOutbox.kind, "hot_leads")));
    await enqueueRunDigests(db, scope, { uploadRef, portalBaseUrl: "https://app.test", prefs: DEFAULT_NOTIFICATION_PREFS, audience: "partner" });
    const rows = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.tenantId, scope.tenantId), eq(schema.emailOutbox.kind, "hot_leads")));
    // Exactly one partner hot email, to the normal partner (house has no email + is excluded).
    expect(rows).toHaveLength(1);
    const partnerHot = rows[0];
    expect(partnerHot.toAddress).toBe("pinnacle@partner.test");
    expect(partnerHot.body).toContain(P_HOT);
    // A partner never sees a house-territory or unmatched hot lead.
    expect(partnerHot.body).not.toContain(HOUSE_HOT);
    expect(partnerHot.body).not.toContain(UNMATCHED_HOT);
    // SEC-05: no seller email leaks into the alert.
    expect(partnerHot.body).not.toMatch(/@partner\.test/); // only the recipient address, never inside the body
  });
});
