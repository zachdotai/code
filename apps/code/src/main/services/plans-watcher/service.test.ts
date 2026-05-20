import { describe, expect, it } from "vitest";
import {
  findBlockInsertionLine,
  findExistingThreadRange,
  formatThreadLine,
  isThreadLine,
} from "./service";

const SAMPLE_PLAN = `# Plan

## Step 1: Refactor auth middleware

Move session validation from middleware to a dedicated service.

## Step 2: Update tests

Add coverage for the new service.
`;

describe("plans-watcher helpers", () => {
  describe("isThreadLine", () => {
    it("recognises `[H]:` lines", () => {
      expect(isThreadLine("> [H]: hello")).toBe(true);
    });
    it("recognises `[A]:` lines", () => {
      expect(isThreadLine("> [A]: hi back")).toBe(true);
    });
    it("recognises `[resolved]` markers", () => {
      expect(isThreadLine("> [resolved]")).toBe(true);
    });
    it("ignores regular blockquotes", () => {
      expect(isThreadLine("> just a quote")).toBe(false);
    });
    it("ignores blank lines and paragraphs", () => {
      expect(isThreadLine("")).toBe(false);
      expect(isThreadLine("Move session validation…")).toBe(false);
    });
  });

  describe("findBlockInsertionLine", () => {
    it("returns the line after the matched block", () => {
      const lines = SAMPLE_PLAN.split("\n");
      const line = findBlockInsertionLine(
        lines,
        "Move session validation from middleware",
      );
      // Source line 4 (0-indexed) is the paragraph; insertion is line 5.
      expect(line).toBe(5);
    });

    it("matches across multiple source lines", () => {
      const lines = ["a paragraph", "spanning", "three lines", "", "next"];
      const line = findBlockInsertionLine(lines, "paragraph\nspanning\nthree");
      expect(line).toBe(3);
    });

    it("returns null when no block matches", () => {
      expect(findBlockInsertionLine(SAMPLE_PLAN.split("\n"), "nope")).toBe(
        null,
      );
    });
  });

  describe("findExistingThreadRange", () => {
    it("returns null when no thread exists", () => {
      const lines = ["paragraph", "", "another paragraph"];
      expect(findExistingThreadRange(lines, 1)).toBe(null);
    });

    it("identifies a contiguous thread block", () => {
      const lines = [
        "paragraph",
        "",
        "> [H]: question",
        "> [A]: answer",
        "",
        "next",
      ];
      const range = findExistingThreadRange(lines, 1);
      expect(range).toEqual({ start: 2, end: 4 });
    });

    it("includes a trailing `[resolved]` marker", () => {
      const lines = [
        "paragraph",
        "",
        "> [H]: question",
        "> [A]: answer",
        "> [resolved]",
        "",
        "next",
      ];
      const range = findExistingThreadRange(lines, 1);
      expect(range).toEqual({ start: 2, end: 5 });
    });
  });

  describe("formatThreadLine", () => {
    it("emits a single-line blockquote with the speaker tag", () => {
      expect(formatThreadLine("H", "hello world")).toBe("> [H]: hello world");
    });
    it("collapses newlines in the message", () => {
      expect(formatThreadLine("A", "line one\n  line two")).toBe(
        "> [A]: line one line two",
      );
    });
  });
});
