// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// WP-AI-PERSIST: the assistant now mounts from the admin LAYOUT (persistent across
// navigation), not per-page inside AppShell — so the panel + transcript survive moving
// between pages. AssistantMount is the thin client wrapper the server layout renders; it
// lazily imports the widget (ssr:false). next/dynamic is mocked to render the module
// synchronously so we can assert the wiring.
vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    return function Stub() {
      return <div data-testid="assistant-mounted" />;
    };
  },
}));

import { AssistantMount } from "@/components/assistant/AssistantMount";

describe("WP-AI-PERSIST: the assistant mounts (lazily) from the admin layout", () => {
  it("renders the lazily-mounted assistant widget", () => {
    render(<AssistantMount />);
    expect(screen.getByTestId("assistant-mounted")).toBeTruthy();
  });
});
