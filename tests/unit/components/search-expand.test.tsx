// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchExpand } from "@/components/SearchExpand";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("DSN: SearchExpand", () => {
  it("DSN-SR-01: expands on click and routes to /leads on submit", () => {
    render(<SearchExpand />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "98101" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/leads?q=98101");
  });
});
