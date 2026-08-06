// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDirty } from "@/lib/use-dirty";

// FRM-02a: has the form changed since its baseline? Callers feed the result to
// <Dialog confirmClose> so a dismiss gesture on a dirty form asks before discarding.
describe("FRM-02a: useDirty", () => {
  it("UD-01: is not dirty when the value equals its captured baseline", () => {
    const { result } = renderHook(() => useDirty({ name: "" }));
    expect(result.current).toBe(false);
  });

  it("UD-02: becomes dirty once the value differs from the baseline", () => {
    const { result, rerender } = renderHook(({ v }) => useDirty(v), { initialProps: { v: { name: "" } } });
    expect(result.current).toBe(false);
    rerender({ v: { name: "Josh" } });
    expect(result.current).toBe(true);
  });

  it("UD-03: returns to not-dirty when the value is edited back to the baseline", () => {
    const { result, rerender } = renderHook(({ v }) => useDirty(v), { initialProps: { v: { name: "" } } });
    rerender({ v: { name: "Josh" } });
    expect(result.current).toBe(true);
    rerender({ v: { name: "" } });
    expect(result.current).toBe(false);
  });

  it("UD-04: with ready=false, the baseline is deferred — pre-seed changes are NOT the baseline", () => {
    // Edit forms seed asynchronously: the baseline must be the loaded record, not the
    // blank pre-seed value. Until ready flips true, nothing is dirty and no baseline is set.
    const { result, rerender } = renderHook(({ v, ready }) => useDirty(v, ready), {
      initialProps: { v: { zips: "" }, ready: false },
    });
    // A pre-seed value change while not ready still reports not-dirty (no baseline yet).
    rerender({ v: { zips: "08034" }, ready: false });
    expect(result.current).toBe(false);
    // Seeding completes: this loaded value becomes the baseline.
    rerender({ v: { zips: "08034" }, ready: true });
    expect(result.current).toBe(false);
    // A change after seeding is dirty.
    rerender({ v: { zips: "08034, 08035" }, ready: true });
    expect(result.current).toBe(true);
  });
});
