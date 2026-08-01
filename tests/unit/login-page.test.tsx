// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "@/app/login/login-form";

// LoginForm reads useRouter + useSearchParams (the `?next=` return path).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom has no ResizeObserver; some @/components primitives observe size. Stub so mount is safe.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

describe("WP-SU-21: login page 'Sign up' link", () => {
  it("shows the Sign up link (→ /signup) when signup is enabled", () => {
    render(<LoginForm signupEnabled={true} />);
    const link = screen.getByRole("link", { name: /sign up/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/signup");
  });

  it("hides the Sign up link when signup is disabled (compliance kill-switch)", () => {
    render(<LoginForm signupEnabled={false} />);
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
  });

  it("still renders Forgot password regardless (control — the form itself is unchanged)", () => {
    render(<LoginForm signupEnabled={false} />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toBeTruthy();
  });
});
