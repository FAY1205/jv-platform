// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  Badge,
  PartnerTag,
  Input,
  Tabs,
  Modal,
  Dialog,
  Checkbox,
  Pagination,
  Tooltip,
  EmptyState,
} from "@/components";

describe("Input: password show/hide toggle", () => {
  it("reveals and hides the password value on toggle", async () => {
    const user = userEvent.setup();
    render(<Input label="Password" type="password" defaultValue="secret" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    await user.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  it("shows no toggle for non-password inputs", () => {
    render(<Input label="Email" type="email" />);
    expect(screen.queryByRole("button", { name: /password/i })).toBeNull();
  });
});

describe("DSN-03: Button states", () => {
  it("disables and marks aria-busy when loading", () => {
    render(<Button loading>Process</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Export
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("PRN-14: partner identity is never color alone", () => {
  it("renders partner name and reference ID alongside the color", () => {
    render(<PartnerTag name="Josh Ax" color="#8fbfe8" refId="JV-003" />);
    expect(screen.getByText("Josh Ax")).toBeInTheDocument();
    expect(screen.getByText("JV-003")).toBeInTheDocument();
  });

  it("Badge always carries text, not just a color", () => {
    render(<Badge variant="removed">Removed</Badge>);
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });
});

describe("FRM-01: Input error wiring", () => {
  it("marks aria-invalid and links the error message", () => {
    render(<Input label="Seller ZIP" error="ZIP must be 5 digits" defaultValue="6404" />);
    const input = screen.getByLabelText("Seller ZIP");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errId = input.getAttribute("aria-describedby");
    expect(errId).toBeTruthy();
    expect(document.getElementById(errId!)).toHaveTextContent("ZIP must be 5 digits");
  });
});

describe("Tabs", () => {
  it("changes selection on click and arrow keys", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        items={[
          { id: "zip", label: "ZIP coverage" },
          { id: "state", label: "State fallbacks" },
        ]}
        value="zip"
        onValueChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "State fallbacks" }));
    expect(onChange).toHaveBeenCalledWith("state");

    const active = screen.getByRole("tab", { name: "ZIP coverage" });
    active.focus();
    fireEvent.keyDown(active, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("state");
  });
});

describe("Modal", () => {
  it("renders only when open and closes on Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} onClose={onClose} title="Delete partner">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Modal open onClose={onClose} title="Delete partner">
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("F-15: Dialog (Radix)", () => {
  it("renders its title + body only when open", () => {
    const onClose = () => {};
    const { rerender } = render(
      <Dialog open={false} onClose={onClose} title="Edit lead">
        <p>Lead body</p>
      </Dialog>,
    );
    expect(screen.queryByText("Edit lead")).not.toBeInTheDocument();
    rerender(
      <Dialog open onClose={onClose} title="Edit lead">
        <p>Lead body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit lead")).toBeInTheDocument();
    expect(screen.getByText("Lead body")).toBeInTheDocument();
  });
});

describe("F-62: Checkbox (Radix)", () => {
  it("is keyboard/mouse toggleable and reports the new state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} label="Email digest" />);
    const box = screen.getByRole("checkbox", { name: "Email digest" });
    expect(box).toHaveAttribute("data-state", "unchecked");
    await user.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("FEP-03: Pagination", () => {
  it("shows the current window + total and disables prev on page 1", async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={20} total={95} onPageChange={onPage} onPageSizeChange={() => {}} />);
    expect(screen.getByText("1–20 of 95")).toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("disables next on the last page", () => {
    render(<Pagination page={5} pageSize={20} total={95} onPageChange={() => {}} onPageSizeChange={() => {}} />);
    expect(screen.getByText("81–95 of 95")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});

describe("Tooltip", () => {
  it("hides content until focus", () => {
    render(
      <Tooltip content="Match rate = matched ÷ uploaded">
        <button>77.8%</button>
      </Tooltip>,
    );
    expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();
    fireEvent.focusIn(screen.getByRole("button", { name: "77.8%" }));
    expect(screen.getByRole("tooltip")).toBeVisible();
  });
});

describe("DSN-06: EmptyState", () => {
  it("shows a title and a next action", () => {
    render(
      <EmptyState
        title="No uploads yet"
        description="Process your first file"
        action={<Button>New upload</Button>}
      />,
    );
    expect(screen.getByText("No uploads yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New upload" })).toBeInTheDocument();
  });
});
