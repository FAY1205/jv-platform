import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type * as ScopeContextModule from "@/lib/scope-context";
import { APP_ORIGIN, adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// getServerScope is injected at its module seam so the routes run as a real caller
// without a live Supabase session (see _route-harness). CSRF, the Zod contracts, the
// task commands, and the DB all stay real — this suite covers the routes' own
// contract: status codes + the uniform {code,message,traceId} envelope, which the
// module-level suite (tasks-api.test.ts) never exercises.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET as listTasks, POST as createTask } from "@/app/api/leads/[ref]/tasks/route";
import { PATCH as patchTask, DELETE as deleteTask } from "@/app/api/tasks/[id]/route";
import { GET as myTasks } from "@/app/api/tasks/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-tasks";
const REF = "LD-26-91001";

suite("WP-TSK-2: task route contract (status + error envelope)", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  // randomUUID()'s branded return type is what adminScope's default parameter expects —
  // declaring these as plain `string` breaks the call site (tsc, not vitest, catches it).
  const adminUserId = randomUUID();
  const partnerUserId = randomUUID();

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Route Tasks", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId, refId: "JV-911", name: "Route Partner", color: "#123456", status: "active" })
      .returning({ id: schema.partners.id });
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId, email: "admin@route-tasks.test", role: "admin" as const },
      { id: partnerUserId, tenantId, email: "px@route-tasks.test", role: "partner" as const, partnerId: p.id },
    ]);
    const [u] = await db
      .insert(schema.uploads)
      .values({ tenantId, refId: "IM-26-911", filename: "leads.csv", status: "processed" })
      .returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId, refId: REF, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept", matchMethod: "zip", partnerId: p.id,
    });
    setRouteScope(adminScope(tenantId, adminUserId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

  async function createOk(payload: Record<string, unknown>): Promise<string> {
    const res = await createTask(jsonRequest("POST", `/api/leads/${REF}/tasks`, payload), routeParams({ ref: REF }));
    expect(res.status).toBe(200);
    return (await body(res)).id as string;
  }

  it("TSK-01: POST creates a task and GET returns the caller's stream", async () => {
    const id = await createOk({ title: "Route-created task", dueOn: "2026-08-20" });
    expect(id).toBeTruthy();

    const res = await listTasks(jsonRequest("GET", `/api/leads/${REF}/tasks`), routeParams({ ref: REF }));
    expect(res.status).toBe(200);
    const payload = (await body(res)).tasks as { id: string; title: string; dueOn: string | null }[];
    const created = payload.find((t) => t.id === id);
    expect(created?.title).toBe("Route-created task");
    expect(created?.dueOn).toBe("2026-08-20");
  });

  it("returns 400 invalid_ref for a malformed lead reference, 404 for an unknown one", async () => {
    const bad = await listTasks(jsonRequest("GET", "/api/leads/nope/tasks"), routeParams({ ref: "nope" }));
    expect(bad.status).toBe(400);
    expect((await body(bad)).code).toBe("invalid_ref");

    const missing = await listTasks(jsonRequest("GET", "/api/leads/LD-26-99999/tasks"), routeParams({ ref: "LD-26-99999" }));
    expect(missing.status).toBe(404);
    const env = await body(missing);
    expect(env.code).toBe("not_found");
    expect(env.traceId).toEqual(expect.any(String)); // uniform envelope
  });

  it("Zod-validates the create body (empty title, over-long title, bad due date)", async () => {
    const payloads = [
      {},
      { title: "   " },
      { title: "x".repeat(201) },
      { title: "ok", dueOn: "2026-02-31" }, // rolls forward to Mar 3 — not a real Feb date
      // Regex-valid but UNREAL month/day: these built an Invalid Date whose .toISOString()
      // threw RangeError straight out of safeParse — a raw 500, outside the envelope
      // (pr-review HIGH). They must be plain 400s.
      { title: "ok", dueOn: "2026-13-01" },
      { title: "ok", dueOn: "2026-00-05" },
      { title: "ok", dueOn: "2026-01-00" },
    ];
    for (const payload of payloads) {
      const res = await createTask(jsonRequest("POST", `/api/leads/${REF}/tasks`, payload), routeParams({ ref: REF }));
      expect(res.status, `payload ${JSON.stringify(payload)}`).toBe(400);
      const env = await body(res);
      expect(env.code).toBe("invalid_input");
      expect(env.traceId).toEqual(expect.any(String)); // uniform envelope, not a framework 500
    }
  });

  it("rejects an unknown key in either PATCH body shape (strict)", async () => {
    const id = await createOk({ title: "strictness" });
    for (const payload of [{ titel: "typo" }, { action: "complete", title: "mixed" }]) {
      const res = await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, payload), routeParams({ id }));
      expect(res.status, `payload ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(res)).code).toBe("invalid_input");
    }
    // …and the task is untouched by the rejected requests.
    const [row] = await db.select({ title: schema.leadTasks.title, doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, id));
    expect(row.title).toBe("strictness");
    expect(row.doneAt).toBeNull();
  });

  it("TSK-03: a cross-stream assignee is refused with 400 invalid_assignee", async () => {
    const res = await createTask(
      jsonRequest("POST", `/api/leads/${REF}/tasks`, { title: "cross stream", assignedToUserId: partnerUserId }),
      routeParams({ ref: REF }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).code).toBe("invalid_assignee");
  });

  it("TSK-04: PATCH complete/reopen are 200 and idempotent; a closed task's edit is 409", async () => {
    const id = await createOk({ title: "lifecycle" });

    expect((await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { action: "complete" }), routeParams({ id }))).status).toBe(200);
    expect((await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { action: "complete" }), routeParams({ id }))).status).toBe(200);

    const closed = await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { title: "renamed" }), routeParams({ id }));
    expect(closed.status).toBe(409);
    expect((await body(closed)).code).toBe("task_closed");

    expect((await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { action: "reopen" }), routeParams({ id }))).status).toBe(200);
    const edited = await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { title: "renamed" }), routeParams({ id }));
    expect(edited.status).toBe(200);
    const [row] = await db.select({ title: schema.leadTasks.title }).from(schema.leadTasks).where(eq(schema.leadTasks.id, id));
    expect(row.title).toBe("renamed");
  });

  it("rejects a malformed task id (400) and an unknown/foreign one (404)", async () => {
    const badId = await patchTask(jsonRequest("PATCH", "/api/tasks/not-a-uuid", { action: "complete" }), routeParams({ id: "not-a-uuid" }));
    expect(badId.status).toBe(400);
    expect((await body(badId)).code).toBe("invalid_id");

    const unknown = randomUUID();
    const missing = await patchTask(jsonRequest("PATCH", `/api/tasks/${unknown}`, { action: "complete" }), routeParams({ id: unknown }));
    expect(missing.status).toBe(404);
    expect((await body(missing)).code).toBe("not_found");
  });

  it("rejects an empty edit body with 400 invalid_input and an unknown action likewise", async () => {
    const id = await createOk({ title: "body validation" });
    const empty = await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, {}), routeParams({ id }));
    expect(empty.status).toBe(400);
    expect((await body(empty)).code).toBe("invalid_input");

    const bogus = await patchTask(jsonRequest("PATCH", `/api/tasks/${id}`, { action: "explode" }), routeParams({ id }));
    expect(bogus.status).toBe(400);
    expect((await body(bogus)).code).toBe("invalid_input");
  });

  it("TSK-05: DELETE removes the task, and deleting it again is 404", async () => {
    const id = await createOk({ title: "to be deleted" });
    expect((await deleteTask(jsonRequest("DELETE", `/api/tasks/${id}`), routeParams({ id }))).status).toBe(200);
    const gone = await deleteTask(jsonRequest("DELETE", `/api/tasks/${id}`), routeParams({ id }));
    expect(gone.status).toBe(404);
  });

  it("TSK-07: GET /api/tasks returns the caller's paginated task page", async () => {
    const res = await myTasks(jsonRequest("GET", "/api/tasks?status=open&page=1"));
    expect(res.status).toBe(200);
    const page = await body(res);
    expect(page.page).toBe(1);
    expect(typeof page.total).toBe("number");
    expect(Array.isArray(page.items)).toBe(true);

    // An unparseable page degrades to the default rather than 400-ing.
    const degraded = await body(await myTasks(jsonRequest("GET", "/api/tasks?status=nonsense&page=abc")));
    expect(degraded.page).toBe(1);
  });

  it("AUT-12: a mutating request without the CSRF pair is rejected with 403", async () => {
    const naked = new Request(`${APP_ORIGIN}/api/leads/${REF}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "no csrf" }),
    });
    const res = await createTask(naked, routeParams({ ref: REF }));
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("csrf_rejected");
  });

  it("returns 401 when there is no session", async () => {
    setRouteScope(null);
    try {
      const res = await listTasks(jsonRequest("GET", `/api/leads/${REF}/tasks`), routeParams({ ref: REF }));
      expect(res.status).toBe(401);
      expect((await body(res)).code).toBe("unauthenticated");
      const mine = await myTasks(jsonRequest("GET", "/api/tasks"));
      expect(mine.status).toBe(401);
    } finally {
      setRouteScope(adminScope(tenantId, adminUserId));
    }
  });
});
