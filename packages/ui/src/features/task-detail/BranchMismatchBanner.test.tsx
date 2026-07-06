import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BranchMismatchBanner } from "./BranchMismatchBanner";

function renderBanner(
  overrides?: Partial<Parameters<typeof BranchMismatchBanner>[0]>,
) {
  const handlers = {
    onSwitch: vi.fn(),
    onUseCurrentBranch: vi.fn(),
    onDismiss: vi.fn(),
  };
  render(
    <Theme>
      <BranchMismatchBanner
        linkedBranch="feat/foo"
        currentBranch="main"
        actionError={null}
        isSwitching={false}
        isRelinking={false}
        {...handlers}
        {...overrides}
      />
    </Theme>,
  );
  return handlers;
}

describe("BranchMismatchBanner", () => {
  it("shows both branches", () => {
    renderBanner();

    expect(screen.getByText("feat/foo")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("wires each action to its handler", async () => {
    const user = userEvent.setup();
    const { onSwitch, onUseCurrentBranch, onDismiss } = renderBanner();

    await user.click(screen.getByRole("button", { name: "Switch branch" }));
    await user.click(
      screen.getByRole("button", { name: "Use current branch" }),
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onUseCurrentBranch).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the action error", () => {
    renderBanner({ actionError: "dirty worktree" });

    expect(screen.getByText("dirty worktree")).toBeInTheDocument();
  });

  it("disables actions while a switch is in flight", () => {
    renderBanner({ isSwitching: true });

    expect(
      screen.getByRole("button", { name: "Use current branch" }),
    ).toBeDisabled();
  });
});
