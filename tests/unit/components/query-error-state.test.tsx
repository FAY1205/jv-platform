// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryErrorState } from "@/components/QueryErrorState";
import { ApiError } from "@/lib/api";

// UXQ-01a (proposed spec amendment): every async data-fetch error state renders the
// server's traceId and a Retry action where the query is refetchable. Mirrors error.tsx.
describe("UXQ-01a: QueryErrorState", () => {
  it("QES-01: renders the caller's title and the error message", () => {
    render(<QueryErrorState title="Couldn't load partners" error={new Error("The database is unavailable.")} />);
    expect(screen.getByText("Couldn't load partners")).toBeTruthy();
    expect(screen.getByText("The database is unavailable.")).toBeTruthy();
  });

  it("QES-02: surfaces the server traceId as a Reference line when the error is an ApiError", () => {
    const err = new ApiError("The database is unavailable.", "db_down", "trace-abc-123", 500);
    render(<QueryErrorState title="Couldn't load partners" error={err} />);
    expect(screen.getByText(/Reference:/)).toBeTruthy();
    expect(screen.getByText(/trace-abc-123/)).toBeTruthy();
  });

  it("QES-03: shows no Reference line for a plain Error that carries no traceId", () => {
    render(<QueryErrorState title="Couldn't load partners" error={new Error("boom")} />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });

  it("QES-04: renders a Retry that calls onRetry, and omits it when onRetry is not given", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <QueryErrorState title="Couldn't load partners" error={new Error("boom")} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<QueryErrorState title="Couldn't load partners" error={new Error("boom")} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("QES-05 (D2, SC 4.1.3): announces as a status region — it replaces loaded content after a settle", () => {
    render(<QueryErrorState title="Couldn't load partners" error={new Error("boom")} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("QES-06: the compact variant still surfaces the traceId and a Retry", () => {
    const onRetry = vi.fn();
    const err = new ApiError("boom", "db_down", "trace-xyz-789", 500);
    render(<QueryErrorState compact title="Couldn't load your leads." error={err} onRetry={onRetry} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/trace-xyz-789/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("QES-07: an explicit description overrides the message derived from the error (Not-found fallback)", () => {
    // Detail dialogs render `error || !data` — when the entity is simply missing there is no
    // Error object, so callers pass a "Not found." description while still handing us the error
    // (null here) for the optional traceId.
    render(<QueryErrorState title="Couldn't load lead" description="Not found." error={null} />);
    expect(screen.getByText("Not found.")).toBeTruthy();
  });
});
