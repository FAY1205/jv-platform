// @vitest-environment jsdom
import * as React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-N5e — the owner's hands-on round on the shipped lead record. Every case here is a
// DEFECT THEY FOUND, not a refinement someone thought of: the pager reading ahead of the
// record's own ID, two floating control chips that matched nothing else on the record, a
// truncated email, a date broken across two lines, and an address split into the four columns
// it is STORED in rather than the one line it is read in.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

const REF = "LD-26-00929";

function baseDetail() {
  return {
    refId: REF,
    seller: { first: "Robert", last: "Thompson", phone: "(859) 938-9128", email: "rt@example.test" },
    address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
    campaign: "Direct mail", notes: "", reasonForSelling: "Relocation / moving", motivation: "",
    timeToSell: "Within 1-3 months", mlsStatus: "kept" as const, mlsReason: "", status: "New",
    score: { total: 41, group: "hot" as const, status: "complete" as const, breakdown: null },
    editable: true, receivedAt: "2026-08-13T10:00:00.000Z", modifiedAt: null,
    partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
    assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: "75045", original: null },
    availableStatuses: ["New", "Contacted"],
    activity: [],
  };
}
let detail = baseDetail();
/** C-41b: while true the detail read never settles, so the panel stays on the row-derived
 *  partial — the one state in which the record is deliberately not editable. */
let holdDetail = false;

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url.includes("/api/me")) {
        return { email: "a@example.test", role: "admin", capabilities: ["leads.read", "leads.write", "work.write", "views.own"], workspace: { name: "W" }, isPlatformOwner: false };
      }
      if (url.includes("/notes")) return { notes: [] };
      if (url.includes("/tasks")) return { tasks: [] };
      if (url.includes("/partners")) return { partners: [{ id: "p1", refId: "JV-001", name: "Meridian Buyers", color: "#5B7A9E" }] };
      if (holdDetail) return new Promise(() => {});
      return detail;
    }),
  };
});

import { RECORD_CONTROL_CLASS, ToastProvider } from "@/components";
import { LeadDialog } from "@/app/(admin)/leads/lead-dialog";
import type { LeadNav } from "@/app/(admin)/leads/lead-pager";

function navStub(over: Partial<LeadNav> = {}): LeadNav {
  return { index: 3, total: 686, canPrev: true, canNext: true, pending: false, prev: vi.fn(), next: vi.fn(), ...over };
}

function stubFetch(impl?: (url: string, opts: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const spy = vi.fn((url: string, opts: RequestInit) => {
    const r = impl?.(url, opts) ?? { ok: true, body: { refId: REF } };
    return Promise.resolve({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: () => Promise.resolve(r.body ?? {}) });
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}
function patchBodies(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls
    .filter(([, o]) => (o as RequestInit).method === "PATCH")
    .map(([, o]) => JSON.parse((o as RequestInit).body as string));
}

/** The cached list row a click opens the panel from — enough for `adminLeadPlaceholder`. */
const row = {
  refId: REF, seller: "Robert Thompson", address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
  campaign: "Direct mail", mlsStatus: "kept" as const, status: "New", scoreTotal: 41, scoreGroup: "hot" as const,
  partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
  receivedAt: "2026-08-13T10:00:00.000Z", modifiedAt: null, tags: [],
};

function renderPanel({ nav = navStub(), onClose = vi.fn(), seedList = false }: { nav?: LeadNav | null; onClose?: () => void; seedList?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (seedList) qc.setQueryData(["leads", "q|received|desc", 1, 20], { leads: [row], page: 1, pageSize: 20, total: 1 });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadDialog refId={REF} onClose={onClose} nav={nav} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose, nav };
}

/** The record's field grid. Scoping matters: "Status" is also a Timeline filter word, and
 *  the grid is the surface whose ORDER these tests are about. */
const fieldGrid = () => document.querySelector(".grid-cols-6") as HTMLElement;
const addressLineButton = () => screen.getByRole("button", { name: /^Address:/i });
/** True when `a` comes before `b` in the document. */
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  detail = baseDetail();
  holdDetail = false;
  vi.unstubAllGlobals();
});

describe("N5E-01: the record's ID leads its header", () => {
  it("N5E-01: the ref comes BEFORE the pager, not after it", async () => {
    stubFetch();
    renderPanel();
    const ref = await screen.findByText(REF);
    const pager = screen.getByRole("group", { name: "Lead navigation" });
    // The shipped header read "‹ 3 of 686 › LD-26-00929" — the navigation before the thing
    // being navigated. Asserted as a DOM-order relationship, not a snapshot of the header.
    expect(precedes(ref, pager)).toBe(true);
  });

  it("N5E-01: the ✕ still closes the header — the pager did not displace it", async () => {
    stubFetch();
    renderPanel();
    const pager = await screen.findByRole("group", { name: "Lead navigation" });
    expect(precedes(pager, screen.getByRole("button", { name: "Close" }))).toBe(true);
  });
});

describe("N5E-05: the field grid gives each value the width it needs", () => {
  it("N5E-05: Received is nowrap, in the tabular mono it already wore", async () => {
    stubFetch();
    renderPanel();
    await screen.findByText("Robert");
    // The owner's screenshot broke "Aug 5, 2026, 4:50 (wrap) PM" across two lines.
    const label = within(fieldGrid()).getByText("Received");
    const value = label.nextElementSibling as HTMLElement;
    expect(value.className).toContain("whitespace-nowrap");
    expect(within(value).getByText(/2026/).className).toContain("num");
  });

  it("N5E-05: no value in the grid is allowed to ellipsize", async () => {
    stubFetch();
    renderPanel();
    await screen.findByText("Robert");
    // `truncate` is what put "mykelvinlove@gmai…" on the owner's screen. Asserted across
    // EVERY editable value in the grid (their rest control is `<label>: <value>. Edit`), so a
    // field added later cannot quietly reintroduce it. PartnerTag is excluded by construction:
    // it clips a partner NAME it also carries in a `title`, which is a different contract.
    const values = [...fieldGrid().querySelectorAll('button[aria-label*=". Edit"]')];
    expect(values.length).toBeGreaterThan(4);
    for (const v of values) expect(v.className).not.toContain("truncate");
    // The one the owner actually hit, named: Email owns a full row and wraps.
    const email = screen.getByRole("button", { name: /^Email:/i });
    expect(email.closest("div")!.className).toContain("col-span-6");
  });
});

describe("N5E-04: status and assigned partner are labelled fields", () => {
  it("N5E-04: both wear a field label, and sit in one row AFTER Received", async () => {
    stubFetch();
    renderPanel();
    await screen.findByText("Robert");
    const grid = within(fieldGrid());
    const received = grid.getByText("Received");
    const status = grid.getByText("Status");
    const partner = grid.getByText("Assigned partner");
    expect(precedes(received, status)).toBe(true);
    expect(precedes(status, partner)).toBe(true);
    // They are labels of the grid, not headings floating above it.
    expect(status.className).toContain("uppercase");
    expect(partner.className).toContain("uppercase");
  });

  it("N5E-04: the two controls share ONE chrome — same classes, not two lookalikes", async () => {
    stubFetch();
    renderPanel();
    const statusControl = await screen.findByRole("combobox", { name: /^Status for/i });
    const partnerControl = screen.getByRole("combobox", { name: /^Assigned partner:/i });
    // Every class of the shared recipe, on both. A copy-pasted second class list drifts;
    // this fails the moment either control stops using RECORD_CONTROL_CLASS.
    for (const cls of RECORD_CONTROL_CLASS.split(" ")) {
      expect(statusControl.className.split(" ")).toContain(cls);
      expect(partnerControl.className.split(" ")).toContain(cls);
    }
    // …and the status control is no longer the colored pill it is in a table row.
    expect(statusControl.className).not.toContain("rounded-full");
  });

  it("N5E-04/PRN-04: a removed lead still gets the read-only verdict badge, not a control", async () => {
    stubFetch();
    // `baseDetail` is always a KEPT lead, so the removed case has to widen the literal type.
    detail = { ...baseDetail(), mlsStatus: "removed", mlsReason: "Listed on MLS" } as unknown as ReturnType<typeof baseDetail>;
    renderPanel();
    await screen.findByText("Robert");
    expect(screen.queryByRole("combobox", { name: /^Status for/i })).toBeNull();
    expect(within(fieldGrid()).getByText("Removed · MLS")).toBeInTheDocument();
    expect(screen.getByText("Listed on MLS")).toBeInTheDocument();
  });

  it("N5E-04/PRN-14: the partner control still names an unmatched lead in warn colour", async () => {
    stubFetch();
    detail = { ...baseDetail(), partner: null } as unknown as ReturnType<typeof baseDetail>;
    renderPanel();
    const control = await screen.findByRole("combobox", { name: "Assigned partner: Unmatched" });
    expect(within(control).getByText("Unmatched").className).toContain("text-warn");
  });
});

describe("N5E-06: the address is one line that opens into four columns", () => {
  it("N5E-06: the collapsed line is all four columns, as an address is read", async () => {
    stubFetch();
    renderPanel();
    expect(await screen.findByText("8193 Maple St, Dallas, TX 75045")).toBeInTheDocument();
    // The four separate cells the owner objected to are gone from the resting record.
    for (const label of ["City", "State", "ZIP"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}:`, "i") })).toBeNull();
    }
    // Q4: the Google search stays, and it still searches the whole property.
    const link = screen.getByRole("link", { name: /search this property on google/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("8193"));
    expect(link).toHaveAttribute("href", expect.stringContaining("75045"));
  });

  it("N5E-06: clicking the line expands the structured editor with Street already open", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /^Address:/i }));

    const street = await screen.findByRole("textbox", { name: "Street" });
    expect(street).toHaveValue("8193 Maple St");
    // Focus LANDS there — an expansion the reader has to go hunting in is not an edit path.
    expect(document.activeElement).toBe(street);
    // …and the other three columns are there beside it, each its own field.
    for (const label of ["City", "State", "ZIP"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}:`, "i") })).toBeInTheDocument();
    }
  });

  it("N5E-06: Enter on the focused line expands it — the line is a real button", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderPanel();
    const line = await screen.findByRole("button", { name: /^Address:/i });
    line.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "Street" })).toBeInTheDocument();
  });

  it("N5E-06: each sub-field commits its OWN column as a single-key PATCH", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /^Address:/i }));
    // Street is open on arrival: type over it and commit.
    await user.keyboard("8195 Maple St{Enter}");
    // Then a different column, in the same expanded group.
    await user.click(await screen.findByRole("button", { name: /^City:/i }));
    await user.keyboard("Austin{Enter}");

    await waitFor(() => expect(patchBodies(fetchSpy)).toHaveLength(2));
    expect(patchBodies(fetchSpy)).toEqual([
      { fields: { address: "8195 Maple St" } },
      { fields: { city: "Austin" } },
    ]);
  });

  it("N5E-06: the State mask and the ZIP's ledger mono survive the move into the group", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /^Address:/i }));
    await user.keyboard("{Escape}");

    await user.click(await screen.findByRole("button", { name: /^State:/i }));
    await user.keyboard("ok9lahoma{Enter}");
    await waitFor(() => expect(patchBodies(fetchSpy)).toHaveLength(1));
    expect(patchBodies(fetchSpy)[0]).toEqual({ fields: { state: "OK" } });

    expect(screen.getByText("75045").className).toContain("num");
  });

  it("N5E-06: leaving the group collapses it back to the line, carrying the saved value", async () => {
    const user = userEvent.setup();
    // The server accepted it, so the record the panel refetches has the new city.
    stubFetch(() => {
      detail = { ...detail, city: "Austin" };
      return { ok: true, body: { refId: REF } };
    });
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /^Address:/i }));
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /^City:/i }));
    await user.keyboard("Austin{Enter}");

    // Focus moves to a field OUTSIDE the group — the gesture that ends the group's session.
    await user.click(await screen.findByRole("button", { name: /^First name:/i }));

    await waitFor(() => expect(screen.getByText("8193 Maple St, Austin, TX 75045")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^City:/i })).toBeNull();
  });

  it("N5E-06: Esc collapses the group and returns focus to the line, WITHOUT closing the panel", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onClose } = renderPanel();

    await user.click(await screen.findByRole("button", { name: /^Address:/i }));
    await screen.findByRole("textbox", { name: "Street" });

    // 1st Esc: the open sub-field reverts (N5-13, unchanged).
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Street" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // 2nd Esc: nothing is editing, so it collapses the GROUP — the panel is still holding
    // its own Esc for us, which is the only seam Radix's capture-phase listener leaves.
    await user.keyboard("{Escape}");
    const line = await screen.findByRole("button", { name: /^Address:/i });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(line);

    // 3rd Esc: nothing left inside claims it, so the panel closes as it always did.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("N5E-06/N5-04: ↑/↓ stay suppressed while the group is open", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { nav } = renderPanel();
    await user.click(await screen.findByRole("button", { name: /^Address:/i }));
    await screen.findByRole("textbox", { name: "Street" });
    await user.keyboard("{Escape}");

    // Not the text-control exclusion doing the work — no field is editing here, and the
    // press lands on the group's own rest button.
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(nav!.next).not.toHaveBeenCalled();
    expect(nav!.prev).not.toHaveBeenCalled();
  });

  it("N5E-06/WP-UX-7: an address with no parts at all is demoted to Not provided", async () => {
    stubFetch();
    detail = { ...baseDetail(), address: "", city: "", state: "", zip: "" };
    renderPanel();
    const line = await screen.findByRole("button", { name: /^Address: Not provided\. Edit$/ });
    expect(within(line).getByText("Not provided").className).toContain("italic");
    // Nothing to search for, so no link is offered.
    expect(screen.queryByRole("link", { name: /search this property on google/i })).toBeNull();
  });

  it("N5E-06/C-41b: the line paints from the row, but cannot be expanded while partial", async () => {
    const user = userEvent.setup();
    stubFetch();
    holdDetail = true;
    renderPanel({ seedList: true });

    // The row already carries all four parts, so the combined line is real, not a skeleton.
    const line = await screen.findByRole("button", { name: /^Address: 8193 Maple St, Dallas, TX 75045\. Edit$/ });
    expect(line).toBeDisabled();
    await user.click(line);
    expect(screen.queryByRole("textbox", { name: "Street" })).toBeNull();
  });
});
