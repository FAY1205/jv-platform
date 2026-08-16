import { describe, it, expect, vi } from "vitest";
import { adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";
import type * as ScopeContextModule from "@/lib/scope-context";

// C-17: the two admin leads GETs must answer their 500 path with jsonServerError — a static
// message + a logged traceId — and never echo the driver error, whose text can carry the failing
// query's bound params (i.e. seller data). We force the query layer to throw a driver-shaped error
// and assert the response envelope carries none of it. No DB needed (the query is mocked).
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));
vi.mock("@/modules/leads/queries", async (orig) => {
  const actual = await orig<typeof import("@/modules/leads/queries")>();
  const boom = async () => {
    throw new Error("db error: select ... where phone_norm = $1 [5551234567]");
  };
  return { ...actual, listLeads: boom, getAdminLeadDetail: boom };
});

import { GET as getList } from "@/app/api/leads/route";
import { GET as getDetail } from "@/app/api/leads/[ref]/route";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("C-17: leads GET 500s return a sanitized envelope, not the driver error", () => {
  it("GET /api/leads — static message + traceId, no driver text", async () => {
    setRouteScope(adminScope(TENANT));
    const res = await getList(jsonRequest("GET", "/api/leads"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("Failed to list leads.");
    expect(body.code).toBe("leads_list_failed");
    expect(body.traceId).toEqual(expect.any(String));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("5551234567"); // the bound param (seller phone) never leaks
    expect(serialized).not.toContain("phone_norm");
  });

  it("GET /api/leads/[ref] — static message + traceId, no driver text", async () => {
    setRouteScope(adminScope(TENANT));
    const res = await getDetail(jsonRequest("GET", "/api/leads/LD-26-00001"), routeParams({ ref: "LD-26-00001" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("Failed to load lead.");
    expect(body.code).toBe("lead_detail_failed");
    expect(body.traceId).toEqual(expect.any(String));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("5551234567");
    expect(serialized).not.toContain("phone_norm");
  });
});
