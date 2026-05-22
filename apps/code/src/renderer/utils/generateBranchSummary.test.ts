import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchAuthState = vi.hoisted(() => vi.fn());
const mockPromptMutate = vi.hoisted(() => vi.fn());

vi.mock("@features/auth/hooks/authQueries", () => ({
  fetchAuthState: mockFetchAuthState,
}));

vi.mock("@renderer/trpc", () => ({
  trpcClient: {
    llmGateway: { prompt: { mutate: mockPromptMutate } },
  },
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { generateBranchSummary } from "./generateBranchSummary";

describe("generateBranchSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAuthState.mockResolvedValue({ status: "authenticated" });
  });

  it("parses TITLE and CONTEXT from the response", async () => {
    mockPromptMutate.mockResolvedValue({
      content:
        "TITLE: Continue auth refactor\nCONTEXT:\nYou are continuing a refactor of auth.ts.\n\nNext, update the tests.",
    });

    const result = await generateBranchSummary("transcript", "description");

    expect(result).toEqual({
      title: "Continue auth refactor",
      context:
        "You are continuing a refactor of auth.ts.\n\nNext, update the tests.",
    });
  });

  it("returns null when not authenticated", async () => {
    mockFetchAuthState.mockResolvedValue({ status: "unauthenticated" });

    expect(await generateBranchSummary("transcript", "description")).toBeNull();
    expect(mockPromptMutate).not.toHaveBeenCalled();
  });

  it("returns null when the response has no CONTEXT", async () => {
    mockPromptMutate.mockResolvedValue({ content: "TITLE: Just a title" });

    expect(await generateBranchSummary("transcript", "description")).toBeNull();
  });

  it("falls back to a default title when none is parsed", async () => {
    mockPromptMutate.mockResolvedValue({
      content: "CONTEXT:\nSome briefing text.",
    });

    const result = await generateBranchSummary("transcript", "description");

    expect(result).toEqual({
      title: "Branched task",
      context: "Some briefing text.",
    });
  });

  it("returns null when the LLM call throws", async () => {
    mockPromptMutate.mockRejectedValue(new Error("network"));

    expect(await generateBranchSummary("transcript", "description")).toBeNull();
  });
});
