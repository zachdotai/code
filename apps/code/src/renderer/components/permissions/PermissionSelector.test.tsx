import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionSelector } from "./PermissionSelector";

describe("PermissionSelector", () => {
  it("renders MCP permissions using claudeCode.toolName metadata", () => {
    render(
      <Theme>
        <PermissionSelector
          toolCall={{
            toolCallId: "tool-1",
            title: "exec",
            kind: "other",
            rawInput: { command: "info execute-sql" },
            _meta: { claudeCode: { toolName: "mcp__posthog__exec" } },
          }}
          options={[
            { kind: "allow_once", optionId: "allow", name: "Yes" },
            {
              kind: "allow_always",
              optionId: "allow_always",
              name: "Yes, always allow",
            },
          ]}
          onSelect={vi.fn()}
          onCancel={vi.fn()}
        />
      </Theme>,
    );

    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === "posthog - Read execute-sql (MCP)",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^exec$/)).not.toBeInTheDocument();
  });
});
