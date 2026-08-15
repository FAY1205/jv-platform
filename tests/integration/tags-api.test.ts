import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import {
  listTags, createTag, updateTag, deleteTag, attachTag, detachTag, listLeadTags,
  DuplicateTagNameError, TagNotFoundError, LeadNotFoundError,
} from "@/modules/tags/tags";
import { TAG_PALETTE } from "@/lib/tokens/tokens";
import { purgeAuditLog } from "../helpers/audit";

// WP-TAG-1 (TAG-01/03/06) — the tag COMMANDS against a live DB: CRUD, idempotent
// attach/detach, delete-detaches-everywhere, case-insensitive name uniqueness, round-robin
// color assignment, and the audit trail's shape (names stored PLAIN — a workflow label is
// not PII, unlike a note body or task title). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-tags-api";
const REF = "LD-26-30001";
const REF2 = "LD-26-30002";

suite("WP-TAG-1: tag commands", () => {
  let db: ReturnType<typeof getDb>;
  let scope: ScopeContext;
  const adminUserId = randomUUID();

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadTags).where(inArray(schema.leadTags.tenantId, tids));
    await db.delete(schema.tags).where(inArray(schema.tags.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Tags API", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: adminUserId };
    await db.insert(schema.users).values({ id: adminUserId, tenantId: t.id, email: "admin@tags-api.test", role: "admin" });
    const [u] = await db
      .insert(schema.uploads)
      .values({ tenantId: t.id, refId: "IM-26-301", filename: "leads.csv", status: "processed" })
      .returning({ id: schema.uploads.id });
    for (const ref of [REF, REF2]) {
      await db.insert(schema.leads).values({
        tenantId: t.id, refId: ref, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {},
        mlsStatus: "kept", matchMethod: "none",
      });
    }
  });

  afterAll(async () => {
    await cleanup();
  });

  /** Each test starts from an empty tag set AND an empty trail, so counts, round-robin, and
   *  the per-action audit assertions are all deterministic regardless of test order. */
  beforeEach(async () => {
    await db.delete(schema.leadTags).where(eq(schema.leadTags.tenantId, scope.tenantId));
    await db.delete(schema.tags).where(eq(schema.tags.tenantId, scope.tenantId));
    await purgeAuditLog(db, eq(schema.auditLog.tenantId, scope.tenantId));
  });

  const auditFor = (action: string) =>
    db
      .select({ after: schema.auditLog.after, before: schema.auditLog.before, entityType: schema.auditLog.entityType })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, scope.tenantId), eq(schema.auditLog.action, action)));

  it("TAG-01/TAG-03: createTag round-trips and audits the name PLAIN (a label is not PII)", async () => {
    const tag = await createTag(scope, { name: "Probate", color: "teal" });
    expect(tag.color).toBe("teal");

    const rows = await listTags(scope);
    expect(rows).toEqual([{ id: tag.id, name: "Probate", color: "teal", leadCount: 0 }]);

    const entries = await auditFor("tag.created");
    expect(entries).toHaveLength(1);
    expect(entries[0].entityType).toBe("tag");
    // Unmasked, unlike task titles / note bodies (ADR-0031 applies to seller-adjacent text).
    expect(entries[0].after).toMatchObject({ name: "Probate", color: "teal" });
  });

  it("TAG-04: an omitted color takes the next palette slot, round-robin", async () => {
    const made = [];
    for (let i = 0; i < TAG_PALETTE.length + 1; i++) made.push(await createTag(scope, { name: `T${i}` }));
    expect(made.map((m) => m.color)).toEqual([...TAG_PALETTE, TAG_PALETTE[0]]);
  });

  it("TAG-01: names are unique per tenant, CASE-INSENSITIVELY", async () => {
    await createTag(scope, { name: "Probate" });
    await expect(createTag(scope, { name: "probate" })).rejects.toBeInstanceOf(DuplicateTagNameError);
    await expect(createTag(scope, { name: "PROBATE" })).rejects.toBeInstanceOf(DuplicateTagNameError);
    expect(await listTags(scope)).toHaveLength(1);

    // …and a RENAME onto an existing name is refused by the same index, not silently applied.
    const other = await createTag(scope, { name: "Follow-up" });
    await expect(updateTag(scope, other.id, { name: "PROBATE" })).rejects.toBeInstanceOf(DuplicateTagNameError);
    expect((await listTags(scope)).find((t) => t.id === other.id)?.name).toBe("Follow-up");
  });

  it("TAG-03: attach is IDEMPOTENT — a repeat writes no row and no audit entry", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    expect(await attachTag(scope, REF, tag.id)).toEqual({ attached: true });
    expect(await attachTag(scope, REF, tag.id)).toEqual({ attached: false });

    expect(await listLeadTags(scope, REF)).toEqual([{ id: tag.id, name: "Probate", color: expect.any(String) }]);
    expect(await auditFor("tag.attached")).toHaveLength(1);
  });

  it("TAG-03: detach is IDEMPOTENT — removing a tag the lead doesn't carry is a silent no-op", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    await attachTag(scope, REF, tag.id);
    expect(await detachTag(scope, REF, tag.id)).toEqual({ detached: true });
    expect(await detachTag(scope, REF, tag.id)).toEqual({ detached: false });

    expect(await listLeadTags(scope, REF)).toEqual([]);
    expect(await auditFor("tag.detached")).toHaveLength(1);
  });

  it("TAG-06: deleting a tag DETACHES it from every lead, in one transaction", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    const keep = await createTag(scope, { name: "Follow-up" });
    await attachTag(scope, REF, tag.id);
    await attachTag(scope, REF2, tag.id);
    await attachTag(scope, REF, keep.id);
    expect((await listTags(scope)).find((t) => t.id === tag.id)?.leadCount).toBe(2);

    await deleteTag(scope, tag.id);

    expect((await listTags(scope)).map((t) => t.id)).toEqual([keep.id]);
    // Both attachments went with it; the untouched tag's attachment survived.
    expect(await listLeadTags(scope, REF)).toEqual([{ id: keep.id, name: "Follow-up", color: expect.any(String) }]);
    expect(await listLeadTags(scope, REF2)).toEqual([]);
    const entries = await auditFor("tag.deleted");
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toMatchObject({ detached: 2 });
  });

  it("TAG-06: rename + recolor are audited before→after and reflected on the chips", async () => {
    const tag = await createTag(scope, { name: "Probate", color: "teal" });
    await attachTag(scope, REF, tag.id);
    await updateTag(scope, tag.id, { name: "Probate lead", color: "plum" });

    expect(await listLeadTags(scope, REF)).toEqual([{ id: tag.id, name: "Probate lead", color: "plum" }]);
    const entries = await auditFor("tag.updated");
    expect(entries).toHaveLength(1);
    expect(entries[0].before).toMatchObject({ name: "Probate", color: "teal" });
    expect(entries[0].after).toMatchObject({ name: "Probate lead", color: "plum" });
  });

  it("TAG-06: a COLOR-only patch never reports a name clash (asDuplicate is index-scoped)", async () => {
    // Regression (audit-tenancy F-6): asDuplicate used to map ANY 23505 to
    // DuplicateTagNameError with `patch.name ?? ""`, so a colour-only PATCH could surface
    // `A tag called "" already exists.` Colours are not unique — two tags may share one.
    const a = await createTag(scope, { name: "Alpha", color: "teal" });
    const b = await createTag(scope, { name: "Beta", color: "blue" });
    await updateTag(scope, b.id, { color: "teal" });
    const rows = await listTags(scope);
    expect(rows.find((t) => t.id === a.id)?.color).toBe("teal");
    expect(rows.find((t) => t.id === b.id)).toMatchObject({ name: "Beta", color: "teal" });
  });

  it("TAG-02: an unknown tag id or lead ref is refused rather than silently ignored", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    await expect(attachTag(scope, REF, randomUUID())).rejects.toBeInstanceOf(TagNotFoundError);
    await expect(attachTag(scope, "LD-26-99999", tag.id)).rejects.toBeInstanceOf(LeadNotFoundError);
    await expect(updateTag(scope, randomUUID(), { name: "x" })).rejects.toBeInstanceOf(TagNotFoundError);
    await expect(deleteTag(scope, randomUUID())).rejects.toBeInstanceOf(TagNotFoundError);
  });

  it("TAG-06: a RECALLED lead's attachment drops out of the usage count", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    await attachTag(scope, REF, tag.id);
    expect((await listTags(scope))[0].leadCount).toBe(1);
    await db.update(schema.leads).set({ deletedAt: new Date() }).where(eq(schema.leads.refId, REF));
    try {
      // The count an operator sees (and the delete confirmation quotes) matches the leads
      // they can actually reach.
      expect((await listTags(scope))[0].leadCount).toBe(0);
    } finally {
      await db.update(schema.leads).set({ deletedAt: null }).where(eq(schema.leads.refId, REF));
    }
  });

  it("TAG-07: attach/detach write NO timeline entry — audit_log only (recorded decision)", async () => {
    const tag = await createTag(scope, { name: "Probate" });
    await attachTag(scope, REF, tag.id);
    await detachTag(scope, REF, tag.id);
    const [lead] = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.refId, REF));
    // The timeline is built from status history + notes + tasks; tagging touches none of them.
    const history = await db
      .select({ id: schema.leadStatusHistory.id })
      .from(schema.leadStatusHistory)
      .where(eq(schema.leadStatusHistory.leadId, lead.id));
    expect(history).toHaveLength(0);
    expect((await auditFor("tag.attached")).length + (await auditFor("tag.detached")).length).toBe(2);
  });
});
