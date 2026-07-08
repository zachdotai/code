import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  hasFileMentions,
  parseFileMentions,
} from "./parseFileMentions";

function renderParts(content: string) {
  return render(<Theme>{parseFileMentions(content)}</Theme>);
}

describe("parseFileMentions", () => {
  it("highlights a leading slash command", () => {
    renderParts("/deploy the app");
    expect(screen.getByText("/deploy")).toBeInTheDocument();
  });

  it("highlights every slash command, not just the first", () => {
    // A submitted prompt using several skills arrives with its <skill /> tags
    // already flattened to plain /name text.
    renderParts("/first do a thing then /second and finally /third");
    expect(screen.getByText("/first")).toBeInTheDocument();
    expect(screen.getByText("/second")).toBeInTheDocument();
    expect(screen.getByText("/third")).toBeInTheDocument();
  });

  it("highlights a slash command that is not at the start of the string", () => {
    renderParts("please run /cleanup now");
    expect(screen.getByText("/cleanup")).toBeInTheDocument();
  });

  it("does not treat a mid-word slash as a command", () => {
    renderParts("check the and/or logic");
    expect(screen.queryByText("/or")).not.toBeInTheDocument();
  });

  it("renders slash commands alongside file mentions", () => {
    renderParts('/review <file path="src/app/main.ts" /> then /ship');
    expect(screen.getByText("/review")).toBeInTheDocument();
    expect(screen.getByText("app/main.ts")).toBeInTheDocument();
    expect(screen.getByText("/ship")).toBeInTheDocument();
  });

  it("detects slash commands anywhere for hasFileMentions", () => {
    expect(hasFileMentions("run /skill please")).toBe(true);
    expect(hasFileMentions("no commands here")).toBe(false);
  });
});
