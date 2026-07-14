import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));
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

// Packaged renderer served from a file: URL, and dev renderer from the Vite origin.
const PROD_HOME = new URL(
  "file:///Applications/PostHog.app/resources/renderer/main_window/index.html",
);
const DEV_HOME = new URL("http://localhost:5173");

function setup(appHome: URL) {
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
    appHome,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenExternal.mockImplementation(() => Promise.resolve());
});

describe("window open handler", () => {
  it.each(SAFE_URLS)("opens %s externally and denies the window", (url) => {
    const { windowOpenHandler } = setup(PROD_HOME);

    const result = windowOpenHandler({ url });

    expect(result).toEqual({ action: "deny" });
    expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each(UNSAFE_URLS)("blocks %s without opening it", (url) => {
    const { windowOpenHandler } = setup(PROD_HOME);

    const result = windowOpenHandler({ url });

    expect(result).toEqual({ action: "deny" });
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledOnce();
  });

  it("swallows an openExternal rejection instead of leaving it unhandled", async () => {
    mockOpenExternal.mockImplementationOnce(() =>
      Promise.reject(new Error("no handler")),
    );
    const { windowOpenHandler } = setup(PROD_HOME);

    windowOpenHandler({ url: "https://posthog.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWarn).toHaveBeenCalledOnce();
  });
});

describe("will-navigate (packaged, file: home)", () => {
  it.each([
    "file:///Applications/PostHog.app/resources/renderer/main_window/index.html",
    "file:///Applications/PostHog.app/resources/renderer/main_window/index.html#/tasks/1",
    "file:///Applications/PostHog.app/resources/renderer/main_window/assets/app.js",
  ])("treats in-app file %s as internal navigation", (url) => {
    const { willNavigateHandler } = setup(PROD_HOME);
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, url);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it.each([
    "file:///etc/passwd",
    "file:///Applications/PostHog.app/resources/renderer/other/index.html",
  ])("blocks out-of-app file %s (not opened externally either)", (url) => {
    const { willNavigateHandler } = setup(PROD_HOME);
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledOnce();
  });

  it("routes an external https link to the browser", () => {
    const { willNavigateHandler } = setup(PROD_HOME);
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, "https://posthog.com");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(
      "https://posthog.com",
    );
  });
});

describe("will-navigate (dev server, http: home)", () => {
  it.each(["http://localhost:5173/", "http://localhost:5173/sessions/42"])(
    "treats same-origin dev URL %s as internal navigation",
    (url) => {
      const { willNavigateHandler } = setup(DEV_HOME);
      const preventDefault = vi.fn();

      willNavigateHandler({ preventDefault }, url);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(mockOpenExternal).not.toHaveBeenCalled();
    },
  );

  // The old startsWith check treated these as in-app, so an attacker origin
  // could load inside the app window. They must now be punted to the browser:
  // userinfo that resolves to another host, a longer port, and a scheme swap.
  it.each([
    "http://localhost:5173@evil.example/",
    "http://localhost:51730/",
    "https://localhost:5173/",
  ])("does not treat lookalike origin %s as internal", (url) => {
    const { willNavigateHandler } = setup(DEV_HOME);
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, url);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("blocks an unsafe scheme in dev too", () => {
    const { willNavigateHandler } = setup(DEV_HOME);
    const preventDefault = vi.fn();

    willNavigateHandler({ preventDefault }, "file:///etc/passwd");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledOnce();
  });
});
