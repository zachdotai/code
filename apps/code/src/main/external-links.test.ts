import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenExternal = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  shell: { openExternal: mockOpenExternal },
}));

vi.mock("./utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: mockWarn,
      debug: vi.fn(),
    }),
  },
}));

import { setupExternalLinkHandlers } from "./external-links";

type WindowOpenHandler = (details: { url: string }) => { action: string };
type WillNavigateHandler = (
  event: { preventDefault: () => void },
  url: string,
) => void;

function setup() {
  let windowOpenHandler: WindowOpenHandler | undefined;
  let willNavigateHandler: WillNavigateHandler | undefined;
  const window = {
    webContents: {
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        windowOpenHandler = handler;
      },
      on: (event: string, handler: WillNavigateHandler) => {
        if (event === "will-navigate") willNavigateHandler = handler;
      },
    },
  };
  setupExternalLinkHandlers(
    window as unknown as Parameters<typeof setupExternalLinkHandlers>[0],
  );
  if (!windowOpenHandler || !willNavigateHandler) {
    throw new Error("Handlers were not registered");
  }
  return { windowOpenHandler, willNavigateHandler };
}

const SAFE_URLS = [
  "https://posthog.com/docs",
  "http://example.com",
  "mailto:support@posthog.com",
];

// Schemes that dispatch to OS-registered handlers: smb/file enable NTLM
// credential theft on Windows, ms-msdt-class handlers take attacker args,
// and custom schemes deep-link into arbitrary installed apps.
const UNSAFE_URLS = [
  "smb://attacker.example/share",
  "file:///etc/passwd",
  "ms-msdt://id/PCWDiagnostic",
  "custom-scheme://payload",
  "javascript:alert(1)",
  "not a url",
];

// In production the renderer is served from file://, so the will-navigate
// handler treats file: URLs as in-app navigation rather than external links.
const NON_FILE_UNSAFE_URLS = UNSAFE_URLS.filter(
  (url) => !url.startsWith("file:"),
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("window open handler", () => {
  it.each(SAFE_URLS)("opens %s externally and denies the window", (url) => {
    const { windowOpenHandler } = setup();

    const result = windowOpenHandler({ url });

    expect(result).toEqual({ action: "deny" });
    expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each(UNSAFE_URLS)("blocks %s without opening it", (url) => {
    const { windowOpenHandler } = setup();

    const result = windowOpenHandler({ url });

    expect(result).toEqual({ action: "deny" });
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledOnce();
  });
});

describe("will-navigate handler", () => {
  it.each(SAFE_URLS)(
    "prevents navigation to %s and opens it externally",
    (url) => {
      const { willNavigateHandler } = setup();
      const preventDefault = vi.fn();

      willNavigateHandler({ preventDefault }, url);

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(url);
    },
  );

  it.each(NON_FILE_UNSAFE_URLS)(
    "prevents navigation to %s without opening it",
    (url) => {
      const { willNavigateHandler } = setup();
      const preventDefault = vi.fn();

      willNavigateHandler({ preventDefault }, url);

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(mockOpenExternal).not.toHaveBeenCalled();
      expect(mockWarn).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "file:///app/.vite/renderer/main_window/index.html",
    "file:///etc/passwd",
  ])("treats %s as in-app navigation and never opens it externally", (url) => {
    const { willNavigateHandler } = setup();
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, url);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });
});
