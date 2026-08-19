// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-N3C PR c2 — chrome/copy/a11y batch (Q9/Q10/C-58/C-61…C-70). One file per WP batch,
// matching the N3A/N3B precedent; every case name carries its requirement ID.

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({}) }));
// Only the Workspace settings page below consumes this; every other import in this file
// resolves the real module.
vi.mock("@/lib/use-current-user", () => ({
  useCurrentUser: () => ({ data: { workspace: { name: "Acme" } }, isPending: false, error: null, refetch: vi.fn(), canDo: () => true }),
}));
const push = vi.fn();
const refresh = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/",
}));

import AdminTosPage from "@/app/(admin)/tos/page";
import PortalTosPage from "@/app/portal/tos/page";
import { AuthCardHeader } from "@/components/AuthCardHeader";
import { MapCaption } from "@/components/map/MapCaption";
import { Dialog } from "@/components/Dialog";
import { ScrollHintFade } from "@/components/ScrollHint";
import { Table, THead, TBody, Th, Tr } from "@/components/Table";
import { NotesPanel } from "@/components/NotesPanel";
import { HeroKpi } from "@/components/HeroKpi";
import { ToastProvider } from "@/components";
import ResetPage from "@/app/reset/page";
import SignupPage from "@/app/signup/page";
import WorkspaceSettingsPage from "@/app/(admin)/settings/workspace/page";
import { APP_NAME } from "@/lib/app";

const SRC = join(__dirname, "..", "..", "src");
const readSrc = (rel: string) => readFileSync(join(SRC, ...rel.split("/")), "utf8");

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  push.mockReset();
  search = "";
  Object.defineProperty(window, "location", { value: { assign }, writable: true, configurable: true });
});

function withQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ── N3C-06 / owner Q9 — a way off the ToS gate ───────────────────────────────
describe("N3C-06/Q9: sign out from the ToS gates", () => {
  it("N3C-06/Q9: the ADMIN gate signs out server-side and lands on /login", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    withQuery(<AdminTosPage />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      const logout = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/logout"));
      expect(logout).toBeTruthy();
      expect(logout?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    });
    // AUT-14: the redirect is the CALLER's own login screen, not the portal's.
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("N3C-06/Q9: the PORTAL gate signs out and lands on /portal/login", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    withQuery(<PortalTosPage />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/portal/login"));
  });

  it("N3C-06/Q9: the control shows a pending state while signing out (DSN-03)", async () => {
    // A fetch that never settles pins the pending state so it can be asserted.
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    withQuery(<PortalTosPage />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const pending = await screen.findByRole("button", { name: /signing out/i });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
  });

  it("N3C-06/Q9: the accept flow and the N3A full-terms link survive the restructure", () => {
    withQuery(<PortalTosPage />);
    expect(screen.getByRole("button", { name: /i agree/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the full terms" })).toHaveAttribute("href", "/terms");
  });
});

// ── N3C-07 / C-63 — one auth-card identity block ─────────────────────────────
describe("N3C-07/C-63: AuthCardHeader", () => {
  it("N3C-07/C-63: the h1 is the SCREEN's purpose and the product name is its sibling", () => {
    render(<AuthCardHeader title="Create your workspace" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Create your workspace");
    // PRN-12: the brand comes from lib/app, never a literal in component code.
    expect(screen.getByText(APP_NAME)).toBeTruthy();
    expect(screen.getByText(APP_NAME).tagName).toBe("SPAN");
  });

  it("N3C-07/C-63: children carry a supplementary line (the terms page's version stamp)", () => {
    render(<AuthCardHeader title="Terms of Service">Version 2026-01-01</AuthCardHeader>);
    expect(screen.getByText("Version 2026-01-01")).toBeTruthy();
  });

  it("N3C-07/C-63: both ToS gates rejoin the auth-card identity (brand + a real h1)", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const { unmount } = withQuery(<AdminTosPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText(APP_NAME)).toBeTruthy();
    unmount();

    withQuery(<PortalTosPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText(APP_NAME)).toBeTruthy();
  });
});

// ── N3C-08 / owner Q10 — the map plate is phone-hostile ──────────────────────
describe("N3C-08/Q10: MapCaption on phones", () => {
  it("N3C-08/Q10: the plate is hidden below sm and shown from sm up", () => {
    const { container } = render(<MapCaption title="Coverage" subtitle="3 partners" />);
    const plate = container.firstElementChild as HTMLElement;
    expect(plate.className).toContain("hidden");
    expect(plate.className).toContain("sm:block");
    // Still inert to pointers wherever it does render.
    expect(plate.className).toContain("pointer-events-none");
  });
});

// ── N3C-11 / C-65 — pinned dialog chrome + vertical scroll cue ───────────────
describe("N3C-11/C-65: Dialog title/footer sit outside the scroll region", () => {
  function renderDialog(extra?: { footer?: React.ReactNode; bare?: boolean }) {
    return render(
      <Dialog open onClose={() => {}} title="Edit partner" footer={extra?.footer} bare={extra?.bare}>
        <p>Body copy</p>
      </Dialog>,
    );
  }

  it("N3C-11/C-65: neither the title bar nor the footer is inside the scrolling element", () => {
    renderDialog({ footer: <button type="button">Save</button> });
    const scroller = document.querySelector(".overflow-auto") as HTMLElement;
    expect(scroller).toBeTruthy();
    expect(scroller.textContent).toContain("Body copy");
    expect(scroller.textContent).not.toContain("Edit partner");
    expect(scroller.textContent).not.toContain("Save");
  });

  it("N3C-11/C-65: bare mode still drops the body padding, and only the body's", () => {
    const { container } = renderDialog({ bare: true });
    const scroller = container.ownerDocument.querySelector(".overflow-auto") as HTMLElement;
    const bodyWrapper = scroller.firstElementChild as HTMLElement;
    expect(bodyWrapper.className).toBe("");
    // The pinned title bar keeps its own px-5 py-4 regardless of `bare`.
    expect(screen.getByText("Edit partner").parentElement!.className).toContain("px-5");
  });

  it("N3C-11/C-65: the ✕ keeps its C-52 hit-area pseudo-element", () => {
    renderDialog();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("before:-inset-1.5");
    expect(close.className).toContain("pointer-coarse:before:-inset-3.5");
  });

  it("N3C-11/C-65: FRM-02a's discard overlay still covers the WHOLE panel, chrome included", () => {
    render(
      <Dialog open onClose={() => {}} confirmClose title="Edit partner" footer={<button type="button">Save</button>}>
        <p>Body copy</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const overlay = screen.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(overlay.className).toContain("inset-0");
    // The overlay is a child of Content (the element that holds header + body + footer),
    // so inset-0 spans all three — not just the scroll region.
    const content = overlay.parentElement as HTMLElement;
    expect(content.textContent).toContain("Edit partner");
    expect(content.textContent).toContain("Save");
  });

  it("N3C-11/C-65: the vertical fade is inert, hidden from AT, and tokened (PRN-12/PRN-14)", () => {
    const { container } = render(<ScrollHintFade edge="bottom" />);
    const fade = container.querySelector("[data-testid='scroll-more-bottom']") as HTMLElement;
    expect(fade).toBeTruthy();
    expect(fade.className).toContain("pointer-events-none");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade.className).toContain("bg-gradient-to-t");
    expect(fade.className).toContain("from-surface");
    expect(fade.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});

// ── N3C-09 / C-48 §1.2 — no phantom tile in the 3-in-2 KPI grids ────────────
describe("N3C-09/C-48: last KPI tile spans the mobile row", () => {
  it("N3C-09/C-48: HeroKpi forwards a layout className onto the cell, linked and unlinked", () => {
    const { container, rerender } = render(<HeroKpi className="max-sm:col-span-2" label="Closed" value={7} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("max-sm:col-span-2");
    // The LINKED variant is a different element (an <a>) — the class must land there too,
    // or the "New unmatched" drill-down tile would keep its phantom cell.
    rerender(<HeroKpi className="max-sm:col-span-2" label="New unmatched" value={3} href="/unmatched" />);
    const link = screen.getByRole("link", { name: /new unmatched/i });
    expect(link.className).toContain("max-sm:col-span-2");
  });

  it("N3C-09/C-48: both dashboard 3-tile grids give the span to their LAST tile only", () => {
    const src = readSrc("app/(admin)/dashboard/page.tsx");
    // Each hero grid is a single <div> of self-closing <HeroKpi /> cells (plus comments) —
    // no nested elements, so the non-greedy close is exact.
    const grids = [...src.matchAll(/<div className="[^"]*grid-cols-2[^"]*sm:grid-cols-3[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      const tiles = grid.split("<HeroKpi").slice(1);
      expect(tiles).toHaveLength(3);
      // Only the odd tile spans — giving it to two would break the 2-up row it fixes.
      expect(tiles[2]).toContain("max-sm:col-span-2");
      expect(tiles[0]).not.toContain("max-sm:col-span-2");
      expect(tiles[1]).not.toContain("max-sm:col-span-2");
    }
  });
});

// ── N3C-13 / C-67 — the upload dead end offers its own recovery ─────────────
describe("N3C-13/C-67: unrecognized-format card offers the template download", () => {
  // The unrecognized state is reachable only after a real workbook parse in a worker, so
  // these pin the markup at the source — the same approach role-literal-ban.test.ts takes.
  const src = readSrc("app/(admin)/upload/page.tsx");
  const card = src.slice(src.indexOf("This file isn&apos;t the expected format"), src.indexOf("phase === \"parsing\""));

  it("N3C-13/C-67: the error card carries its own <a download> to TEMPLATE_HREF", () => {
    expect(card).toContain("href={TEMPLATE_HREF}");
    expect(card).toContain("download");
    expect(card).toContain("Download template");
    // The sentence must point at THIS button, not at the page header it used to.
    expect(card).toContain("Download the template below");
    expect(card).not.toContain("Download template</span> above");
  });

  it("N3C-13/C-67: the dropzone names both formats `accept` actually allows", () => {
    expect(src).toContain('accept=".xlsx,.csv"');
    expect(src).toContain("Drop a weekly .xlsx or .csv here");
  });
});

// ── C-61 — settings consistency ──────────────────────────────────────────────
describe("C-61: settings + roster consistency", () => {
  it("C-61: the Workspace page's section title matches its nav label", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <WorkspaceSettingsPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "General" })).toBeNull();
  });

  it("C-61: the AI card no longer repeats its own section heading", () => {
    // The section title lives in the page shell; the card must not duplicate it.
    expect(readSrc("app/(admin)/settings/ai/page.tsx")).toContain('title="AI assistant"');
    const card = readSrc("app/(admin)/settings/ai/ai-settings.tsx");
    expect(card).toContain("<CardTitle>Provider connection</CardTitle>");
    expect(card).not.toContain("<CardTitle>AI assistant</CardTitle>");
  });
});

// ── N3C-10 / C-58 — Admin notes wears the dialog's sibling-panel chrome ──────
describe("N3C-10/C-58: NotesPanel variants", () => {
  function renderNotes(variant?: "card" | "section") {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <NotesPanel leadRef="LD-26-00404" title="Admin notes" variant={variant} />
      </QueryClientProvider>,
    );
  }

  it("N3C-10/C-58: variant=\"section\" matches ScorePanel's panel shell + uppercase header", () => {
    const { container } = renderNotes("section");
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("rounded-xl");
    expect(shell.className).toContain("border-border-soft");
    expect(shell.className).toContain("bg-surface-2");
    expect(shell.className).toContain("p-4");
    const heading = screen.getByRole("heading", { name: "Admin notes" });
    expect(heading.className).toContain("uppercase");
    expect(heading.className).toContain("text-step-1");
    expect(heading.className).toContain("text-text-2");
  });

  it("N3C-10/C-58: the DEFAULT stays the standalone card — other call sites are untouched", () => {
    const { container } = renderNotes();
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("bg-surface");
    expect(shell.className).not.toContain("bg-surface-2");
    // The Card path keeps CardTitle's own type treatment, not the uppercase section one.
    expect(screen.getByRole("heading", { name: "Admin notes" }).className).not.toContain("uppercase");
  });

  it("N3C-10/C-58: the note composer works in both variants (chrome only, no behavior change)", () => {
    const { unmount } = renderNotes("section");
    expect(screen.getByLabelText("Add a note")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
    unmount();
    renderNotes();
    expect(screen.getByLabelText("Add a note")).toBeTruthy();
  });
});

// ── N3C-15 / C-70 — auth smalls ──────────────────────────────────────────────
describe("N3C-15/C-70: reset confirm-password validates on blur + submit", () => {
  async function typePair(pw: string, confirm: string) {
    search = "token=abc";
    render(<ResetPage />);
    await userEvent.type(screen.getByLabelText("New password"), pw);
    await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  }

  it("N3C-15/C-70: a mismatch is NOT announced while the field is still being typed", async () => {
    await typePair("correct-horse-battery", "correct-horse");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
  });

  it("N3C-15/C-70: blurring the field reveals the mismatch", async () => {
    await typePair("correct-horse-battery", "correct-horse");
    fireEvent.blur(screen.getByLabelText("Confirm new password"));
    expect(await screen.findByText("Passwords do not match.")).toBeTruthy();
  });

  it("N3C-15/C-70: the error clears while typing once the values agree again", async () => {
    await typePair("correct-horse-battery", "correct-horse");
    fireEvent.blur(screen.getByLabelText("Confirm new password"));
    expect(await screen.findByText("Passwords do not match.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Confirm new password"), "-battery");
    await waitFor(() => expect(screen.queryByText("Passwords do not match.")).toBeNull());
  });

  it("N3C-15/C-70: submitting a mismatch is blocked and surfaces the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    await typePair("correct-horse-battery", "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/reset/confirm"))).toBeUndefined();
    expect(await screen.findByText("Passwords do not match.")).toBeTruthy();
  });
});

describe("N3C-15/C-70: signup with no Turnstile site key", () => {
  it("N3C-15/C-70: the copy is honest about the state and describes the disabled button", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    render(<SignupPage />);
    const note = screen.getByText("Signups are temporarily unavailable.");
    expect(note).toBeTruthy();
    // No "try again later" — nothing about this resolves by retrying.
    expect(note.textContent).not.toMatch(/try again/i);
    const submit = screen.getByRole("button", { name: /sign up/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-describedby")).toBe(note.id);
  });
});

// ── N3C-14 / C-68 — the active sort column is legible at a glance ────────────
describe("N3C-14/C-68: active-sort emphasis", () => {
  function renderHeader(sortDir: "asc" | "desc" | null) {
    return render(
      <Table>
        <THead>
          <Tr>
            <Th sortable sortDir={sortDir} onSort={() => {}}>
              When
            </Th>
          </Tr>
        </THead>
        <TBody />
      </Table>,
    );
  }

  it("N3C-14/C-68: a sorted column renders its label and arrow at full text ink", () => {
    renderHeader("asc");
    const button = screen.getByRole("button", { name: /when/i });
    expect(button.className).toContain("text-text");
    expect(button.querySelector("span")!.className).toContain("text-text");
  });

  it("N3C-14/C-68: an unsorted column stays muted", () => {
    renderHeader(null);
    const button = screen.getByRole("button", { name: /when/i });
    expect(button.className).toContain("text-inherit");
    expect(button.querySelector("span")!.className).toContain("text-text-3");
  });

  it("N3C-14/C-68: aria-sort is untouched — the AT answer was already right", () => {
    const { rerender } = renderHeader("desc");
    expect(document.querySelector("th")).toHaveAttribute("aria-sort", "descending");
    rerender(
      <Table>
        <THead>
          <Tr>
            <Th sortable sortDir={null} onSort={() => {}}>
              When
            </Th>
          </Tr>
        </THead>
        <TBody />
      </Table>,
    );
    expect(document.querySelector("th")).not.toHaveAttribute("aria-sort");
  });
});
