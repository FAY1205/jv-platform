// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeaderProvider, PageHeaderSlot, usePageHeader } from "@/components/PageHeader";

function Page({ title }: { title?: string }) {
  usePageHeader({ title });
  return null;
}

describe("DSN: PageHeader slot", () => {
  it("DSN-PH-01: renders a title a page provides, and nothing when absent", () => {
    const { rerender } = render(
      <PageHeaderProvider>
        <PageHeaderSlot />
        <Page title="Leads" />
      </PageHeaderProvider>,
    );
    expect(screen.getByRole("heading", { name: "Leads" })).toBeInTheDocument();

    rerender(
      <PageHeaderProvider>
        <PageHeaderSlot />
        <Page />
      </PageHeaderProvider>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
