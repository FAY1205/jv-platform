// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMessage, THINKING_COPY } from "@/components/assistant/AssistantMessage";

// AI redesign: assistant answers are FLAT annotations (no boxed chat bubble), each run led by
// a quiet "Assistant" marker (brand tick + label — no orb). These lock the structure the live
// AI call couldn't exercise in the dev harness (no CSRF session).
describe("AssistantMessage — flat annotation + marker (AI redesign)", () => {
  it("firstOfRun shows the 'Assistant' marker above the answer, and renders the answer text", () => {
    render(<AssistantMessage id="a1" text="You have **13** active partners." sources={[]} showThumbs={false} />);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText(/active partners/)).toBeInTheDocument();
  });

  it("firstOfRun={false} omits the marker (a consecutive answer in the same run)", () => {
    render(<AssistantMessage id="a2" text="And 21 unmatched." sources={[]} showThumbs={false} firstOfRun={false} />);
    expect(screen.queryByText("Assistant")).toBeNull();
    expect(screen.getByText(/unmatched/)).toBeInTheDocument();
  });

  it("is NOT a boxed bubble — no border/surface card wrapper around the answer", () => {
    const { container } = render(<AssistantMessage id="a3" text="Hello." sources={[]} showThumbs={false} />);
    const root = container.firstElementChild as HTMLElement;
    // The old design wrapped each reply in `border border-border-soft bg-surface shadow-xs`.
    expect(root.className).not.toContain("bg-surface");
    expect(root.className).not.toContain("border-border-soft");
  });

  it("AIS-04: a reply that returned only a link is never blank — it falls back to a sentence", () => {
    render(<AssistantMessage id="a4" text="" sources={[{ label: "Leads", path: "/leads" }]} showThumbs={false} />);
    expect(screen.getByText(/Open Leads below for the details\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Leads/i })).toBeInTheDocument();
  });

  it("AIS-04: the fallback strips a label's range suffix and NEVER changes case", () => {
    render(<AssistantMessage id="a5" text="" sources={[{ label: "Dashboard stats · 30d", path: "/dashboard" }]} showThumbs={false} />);
    const body = screen.getByText(/Open Dashboard stats below for the details\./);
    expect(body).toBeInTheDocument();
    expect(body.textContent).not.toContain("· 30d");
    expect(body.textContent).not.toContain("dashboard stats"); // no .toLowerCase()
  });

  it("AIS-04: a ref-ID label survives the fallback case-intact and still renders as a mono ref", () => {
    const { container } = render(<AssistantMessage id="a6" text="" sources={[{ label: "Lead LD-25-00123", path: "/leads?open=LD-25-00123" }]} showThumbs={false} />);
    expect(container.textContent).toContain("Open Lead LD-25-00123 below for the details.");
    // Case-sensitive: REF_RE matches LD-, never ld-, so lowercasing would break the ref span too.
    const ref = screen.getAllByText("LD-25-00123").find((el) => el.className.includes("num"));
    expect(ref).toBeTruthy();
  });

  it("AIS-05: a NOT-FOUND source never claims the assistant found something", () => {
    render(<AssistantMessage id="a7" text="" sources={[{ label: "Partner roster", notFound: "Meridian West" }]} showThumbs={false} />);
    expect(screen.getByText(/no match for that reference/i)).toBeInTheDocument();
    expect(screen.queryByText(/here's what i found/i)).toBeNull();
  });

  it("AIS-05: NOT-FOUND outranks a linkable source in a mixed turn", () => {
    render(
      <AssistantMessage
        id="a8"
        text=""
        sources={[{ label: "Dashboard stats · 30d", path: "/dashboard" }, { label: "Leads", notFound: "LD-25-99999" }]}
        showThumbs={false}
      />,
    );
    expect(screen.getByText(/No match for that reference in Leads/)).toBeInTheDocument();
    expect(screen.queryByText(/below for the details/i)).toBeNull();
  });

  it("AIS-05: a notFound source survives a SAME-label dedup collision (miss beats hit, any order)", () => {
    // Three partner tools share the literal "Partner roster" label; a successful list call
    // landing first must not swallow the miss (review F-1 — the miss is always the news).
    render(
      <AssistantMessage
        id="a8b"
        text=""
        sources={[{ label: "Partner roster", path: "/partners" }, { label: "Partner roster", notFound: "Meridian West" }]}
        showThumbs={false}
      />,
    );
    expect(screen.getByText(/No match for that reference in Partner roster/)).toBeInTheDocument();
    expect(screen.queryByText(/below for the details/i)).toBeNull();
  });

  it("AIS-05: sources that ran but produced no prose say so, without apology theatre", () => {
    render(<AssistantMessage id="a9" text="" sources={[{ label: "Coverage map" }]} showThumbs={false} />);
    expect(screen.getByText(/the answer didn't come through/i)).toBeInTheDocument();
  });

  it("AIS-05: no sources at all points back at the assistant's scope", () => {
    render(<AssistantMessage id="a10" text="" sources={[]} showThumbs={false} />);
    expect(screen.getByText(/i don't have an answer for that/i)).toBeInTheDocument();
    expect(screen.getByText(/partners, leads, coverage or imports/i)).toBeInTheDocument();
  });

  it("AIS-06: the pending body is exactly THINKING_COPY — no trailing ellipsis", () => {
    render(<AssistantMessage id="a11" text="" sources={[]} showThumbs={false} pending />);
    const line = screen.getByText(THINKING_COPY);
    expect(line.textContent).toBe(THINKING_COPY);
    expect(THINKING_COPY.endsWith("…")).toBe(false);
    expect(THINKING_COPY.endsWith("...")).toBe(false);
  });
});
