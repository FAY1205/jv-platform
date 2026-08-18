// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// Phase C — Settings → Team (team-page-spec TM-01..13). The roster's affordance rules are the
// UI half of two server invariants (nobody touches the owner; only the workspace owner touches
// admin seats) plus the self-action refusals — exactly the shape that rots silently, so they
// are pinned here. The API layer is mocked; the command side is server-tested.

const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate,
  ApiError: class ApiError extends Error {},
}));

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));

const { me } = vi.hoisted(() => ({ me: { email: "me@example.com", caps: ["team.manage"] as string[] } }));
vi.mock("@/lib/use-current-user", () => ({
  useCurrentUser: () => ({
    data: { email: me.email, role: "admin", capabilities: me.caps, workspace: { name: "Meridian" }, isPlatformOwner: false },
    isSuccess: true,
    canDo: (cap: string) => me.caps.includes(cap),
  }),
}));

import TeamSettingsPage from "@/app/(admin)/settings/team/page";

// Radix Dialog + DropdownMenu need the pointer/observer APIs jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;

const OWNER = { id: "u-owner", email: "morgan@example.com", role: "admin", isOwner: true, deactivatedAt: null, joinedAt: "2026-01-05T10:00:00.000Z" };
const ME = { id: "u-me", email: "me@example.com", role: "admin", isOwner: false, deactivatedAt: null, joinedAt: "2026-02-01T10:00:00.000Z" };
const PRIYA = { id: "u-priya", email: "priya.nair@example.com", role: "admin", isOwner: false, deactivatedAt: null, joinedAt: "2026-03-01T10:00:00.000Z" };
const SAM = { id: "u-sam", email: "sam.okafor@example.com", role: "member", isOwner: false, deactivatedAt: null, joinedAt: "2026-04-01T10:00:00.000Z" };
const DANA = { id: "u-dana", email: "dana.whitfield@example.com", role: "member", isOwner: false, deactivatedAt: "2026-06-01T10:00:00.000Z", joinedAt: "2026-04-02T10:00:00.000Z" };

const PENDING = {
  id: "i-1", email: "jordan.reyes@example.com", role: "member", invitedByEmail: "morgan@example.com",
  createdAt: "2026-08-15T10:00:00.000Z", expiresAt: "2026-08-22T10:00:00.000Z", expired: false,
};
const EXPIRED = {
  id: "i-2", email: "lee.park@example.com", role: "admin", invitedByEmail: "morgan@example.com",
  createdAt: "2026-08-07T10:00:00.000Z", expiresAt: "2026-08-14T10:00:00.000Z", expired: true,
};

const TEAM = { ownerUserId: OWNER.id, members: [OWNER, ME, PRIYA, SAM, DANA], invites: [PENDING, EXPIRED] };

const PERMISSIONS = {
  defaults: {
    member: ["ai.use", "ingest.run", "leads.read", "leads.write", "views.own", "work.write"],
    viewer: ["leads.read", "views.own"],
  },
  effective: {
    member: ["ai.use", "ingest.run", "leads.read", "leads.write", "views.own", "work.write"],
    viewer: ["leads.read", "views.own"],
  },
  configured: { member: false, viewer: false },
  editable: ["ai.use", "data.export", "ingest.run", "leads.write", "partners.manage", "rules.manage", "runs.void", "work.write"],
  alwaysOn: ["leads.read", "views.own"],
  adminLocked: ["ops.admin", "settings.manage", "team.manage"],
};

beforeEach(() => {
  apiGet.mockReset();
  apiMutate.mockReset();
  replace.mockReset();
  me.email = "me@example.com";
  me.caps = ["team.manage"];
  apiGet.mockImplementation(async (url: string) => {
    if (url === "/api/admin/team") return TEAM;
    if (url === "/api/admin/team/permissions") return PERMISSIONS;
    throw new Error(`unexpected apiGet url in test: ${url}`);
  });
  apiMutate.mockResolvedValue({ code: "ok" });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TeamSettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Open a row's ⋯ menu and return its portaled content. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(await screen.findByRole("button", { name: `Actions for ${email}` }));
  return await screen.findByRole("menu");
}

describe("TM: Settings → Team roster", () => {
  it("renders every seat with its role and status pills, invites included", async () => {
    wrap();
    expect(await screen.findByText("morgan@example.com")).toBeInTheDocument();
    expect(screen.getByText("jordan.reyes@example.com")).toBeInTheDocument();
    // PRN-14: the pills carry the WORD, not just a fill.
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getAllByText("Member").length).toBeGreaterThan(0);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Deactivated")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    // The count line comes from the roster query, never re-derived (PRN-15).
    expect(screen.getByText("5 members · 2 invites pending")).toBeInTheDocument();
  });

  it("TM-01: my own row carries the You badge and offers NO actions menu", async () => {
    wrap();
    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for me@example.com" })).toBeNull();
    // …while another seat's menu exists.
    expect(screen.getByRole("button", { name: "Actions for sam.okafor@example.com" })).toBeInTheDocument();
  });

  it("TM-02: the workspace owner's row shows a lock instead of role affordances", async () => {
    wrap();
    expect(await screen.findByText("morgan@example.com")).toBeInTheDocument();
    // Rendered twice by Tooltip: the sr-only text and the tooltip bubble.
    expect(screen.getAllByText(/the workspace Owner can/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Actions for morgan@example.com" })).toBeNull();
  });

  it("TM-05: an admin target's menu items are DISABLED (with the reason) for a non-owner caller", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "priya.nair@example.com");
    expect(within(menu).getByText("Only the workspace owner can manage Admins.")).toBeInTheDocument();
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("data-disabled");
    }
  });

  it("TM-05: the same caller CAN act on a member seat", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "sam.okafor@example.com");
    const change = within(menu).getByRole("menuitem", { name: "Change role…" });
    expect(change).not.toHaveAttribute("data-disabled");
  });

  it("shows a Skeleton while the roster loads and a retryable error state when it fails", async () => {
    apiGet.mockImplementation(() => new Promise(() => {}));
    const { unmount } = wrap();
    expect(await screen.findByText("Loading your team…")).toBeInTheDocument();
    unmount();

    apiGet.mockRejectedValue(new Error("boom"));
    wrap();
    expect(await screen.findByText("Couldn't load your team")).toBeInTheDocument();
  });

  it("shows the it's-just-you empty state when nobody else has a seat", async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === "/api/admin/team") return { ownerUserId: ME.id, members: [ME], invites: [] };
      return PERMISSIONS;
    });
    wrap();
    expect(await screen.findByText("It's just you so far")).toBeInTheDocument();
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });
});

describe("TM-03: invite flow", () => {
  it("rejects a malformed address at the field and sends nothing", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /Invite member/ }));

    await user.type(screen.getByLabelText(/Email address/), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("sends {email, role} and toasts the address on success", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /Invite member/ }));

    await user.type(screen.getByLabelText(/Email address/), "jordan.reyes@example.com");
    await user.click(screen.getByRole("radio", { name: /Viewer/ }));
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/invites", "POST", {
        email: "jordan.reyes@example.com",
        role: "viewer",
      }),
    );
    // A toast renders twice by design (R-56): the visible row and the sr-only live region.
    expect((await screen.findAllByText("Invite sent to jordan.reyes@example.com.")).length).toBeGreaterThan(0);
  });

  it("TM-05/OQ-1: the Admin role card is disabled for a caller who isn't the workspace owner", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /Invite member/ }));
    expect(screen.getByRole("radio", { name: /Admin/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("TM-05/OQ-1: …and enabled for the workspace owner", async () => {
    me.email = OWNER.email;
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /Invite member/ }));
    expect(screen.getByRole("radio", { name: /Admin/ })).not.toHaveAttribute("aria-disabled");
  });
});

describe("TM-08/TM-09: seat lifecycle dialogs", () => {
  it("TM-08: a demotion lists the capabilities lost and labels the confirm with the verb", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "sam.okafor@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Change role…" }));

    const dialog = await screen.findByRole("dialog");
    // No warning until a LOWER role is selected.
    expect(within(dialog).queryByText(/will immediately lose/)).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: /Viewer/ }));

    const warning = await within(dialog).findByText(/will immediately lose/);
    // Derived from the permissions payload's effective sets, not a static constant.
    expect(warning.textContent).toContain("Edit leads & statuses");
    expect(warning.textContent).toContain("Upload & process files");
    expect(within(dialog).getByRole("button", { name: "Change to Viewer" })).toBeInTheDocument();
  });

  it("TM-08: the change PATCHes the seat and toasts the new role", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "sam.okafor@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Change role…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Viewer/ }));
    await user.click(within(dialog).getByRole("button", { name: "Change to Viewer" }));

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/members/u-sam", "PATCH", { role: "viewer" }),
    );
  });

  it("TM-09: the deactivate confirmation NAMES the person and states the blast radius", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "sam.okafor@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Deactivate…" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deactivate sam.okafor@example.com?")).toBeInTheDocument();
    expect(within(dialog).getByText(/signed out on every device/)).toBeInTheDocument();
    expect(within(dialog).getByText(/stays attributed to them/)).toBeInTheDocument();
    expect(within(dialog).getByText(/reactivate them anytime/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Deactivate member" }));
    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/members/u-sam/deactivate", "POST"),
    );
  });

  it("a deactivated seat offers Reactivate instead of Change role / Deactivate", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "dana.whitfield@example.com");
    expect(within(menu).getByRole("menuitem", { name: "Reactivate…" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Deactivate…" })).toBeNull();
  });

  it("TM-04: revoking an invite confirms first, then DELETEs it", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "jordan.reyes@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Revoke invite" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke the invite to jordan.reyes@example.com?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/invites/i-1", "DELETE"),
    );
  });

  it("resending an invite re-issues the link and toasts", async () => {
    const user = userEvent.setup();
    wrap();
    const menu = await openMenu(user, "jordan.reyes@example.com");
    await user.click(within(menu).getByRole("menuitem", { name: "Resend invite" }));

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/invites/i-1", "POST"),
    );
    expect((await screen.findAllByText("Invite re-sent.")).length).toBeGreaterThan(0);
  });
});

describe("TM-13: route visibility", () => {
  it("redirects a caller without team.manage to Settings → Profile (the §6 whole-route exception)", async () => {
    me.caps = [];
    wrap();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings/profile"));
    expect(apiGet).not.toHaveBeenCalledWith("/api/admin/team");
  });
});
