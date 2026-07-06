import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Globe,
  X,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { BROWSER_TAB_FLAG } from "@posthog/shared/constants";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { Box, Flex, Text } from "@radix-ui/themes";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export function useBrowserEnabled(): boolean {
  return useFeatureFlag(BROWSER_TAB_FLAG) || import.meta.env.DEV;
}

// Declared locally so @posthog/ui doesn't depend on electron types.
interface WebviewElement extends HTMLElement {
  getURL(): string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  // The webContents.navigationHistory.* deprecation does not apply here: these
  // are <webview> element methods, still non-deprecated in Electron 42, and the
  // element exposes no navigationHistory. Revisit only if Electron deprecates
  // the tag methods themselves (the fix would be a main-process hop, not a
  // rename).
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

const DEFAULT_URL = "about:blank";

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1)(?=[:/]|$)/i;

// Anything else (file:, chrome:, data:, javascript:, ...) becomes a search.
// Keep in sync with the authoritative main-process guard (setupWebviewHandlers
// in window.ts) — this is convenience, that is the security boundary.
const ALLOWED_SCHEME = /^(https?):\/\//i;

// Loopback defaults to http since dev servers rarely serve https.
export function normalizeAddress(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  if (ALLOWED_SCHEME.test(trimmed) || trimmed === "about:blank") {
    return trimmed;
  }
  // A schemeless "host:port" (e.g. localhost:3000) is a host, not a scheme.
  const hasDisallowedScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) &&
    !/^[^/]+:\d+(?:[/?#]|$)/.test(trimmed);
  const looksLikeHost =
    !hasDisallowedScheme &&
    !/\s/.test(trimmed) &&
    (trimmed.includes(".") || LOOPBACK_HOST.test(trimmed));
  if (looksLikeHost) {
    const scheme = LOOPBACK_HOST.test(trimmed) ? "http" : "https";
    return `${scheme}://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// Electron <webview> DOM events carry their payload as extra props on Event.
type WebviewNavigateEvent = Event & { url: string; isMainFrame?: boolean };
type WebviewTitleEvent = Event & { title: string };
type WebviewFailLoadEvent = Event & {
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
};

interface BrowserPanelProps {
  url: string;
  // Debounced settled main-frame url, for hosts that persist location.
  onUrlChange?: (url: string) => void;
  // Deduped page title, for hosts that show a label.
  onTitleChange?: (title: string) => void;
}

export function BrowserPanel({
  url,
  onUrlChange,
  onTitleChange,
}: BrowserPanelProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  // src is set once so re-renders never reload the page; the value comes off
  // disk and must not be trusted as a raw src.
  const initialUrl = useRef(normalizeAddress(url));
  const [address, setAddress] = useState(url === DEFAULT_URL ? "" : url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Refs so the debounce timer and event effect don't re-arm every render.
  const onUrlChangeRef = useRef(onUrlChange);
  onUrlChangeRef.current = onUrlChange;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUrl = useRef<string | null>(null);
  const lastLabel = useRef<string | null>(null);

  // Hosts persist to disk on every write and SPAs fire many navigation events;
  // coalesce so only the settled url hits storage.
  const persistUrl = useCallback((next: string) => {
    pendingUrl.current = next;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      if (pendingUrl.current !== null) {
        onUrlChangeRef.current?.(pendingUrl.current);
      }
      pendingUrl.current = null;
      persistTimer.current = null;
    }, 500);
  }, []);

  // Flush on unmount so the last location isn't lost inside the debounce window.
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (pendingUrl.current !== null) {
        onUrlChangeRef.current?.(pendingUrl.current);
      }
    },
    [],
  );

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onNavigate = (e: Event) => {
      const ev = e as WebviewNavigateEvent;
      // Subframe navigations must not hijack the address bar or persisted url.
      if (ev.isMainFrame === false) return;
      const next = ev.url ?? webview.getURL();
      setAddress(next === DEFAULT_URL ? "" : next);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      setLoadError(null);
      persistUrl(next);
    };

    const onTitle = (e: Event) => {
      const { title } = e as WebviewTitleEvent;
      // SPAs rewrite the title constantly; skip the host write when unchanged.
      if (title && title !== lastLabel.current) {
        lastLabel.current = title;
        onTitleChangeRef.current?.(title);
      }
    };

    const onFailLoad = (e: Event) => {
      const ev = e as WebviewFailLoadEvent;
      // Ignore subframe failures and user-aborted loads (errorCode -3).
      if (ev.isMainFrame === false || ev.errorCode === -3) return;
      setLoadError(ev.errorDescription || "Failed to load page");
    };

    const onStartLoading = () => setIsLoading(true);
    const onStopLoading = () => setIsLoading(false);

    webview.addEventListener("did-navigate", onNavigate);
    webview.addEventListener("did-navigate-in-page", onNavigate);
    webview.addEventListener("page-title-updated", onTitle);
    webview.addEventListener("did-fail-load", onFailLoad);
    webview.addEventListener("did-start-loading", onStartLoading);
    webview.addEventListener("did-stop-loading", onStopLoading);

    return () => {
      webview.removeEventListener("did-navigate", onNavigate);
      webview.removeEventListener("did-navigate-in-page", onNavigate);
      webview.removeEventListener("page-title-updated", onTitle);
      webview.removeEventListener("did-fail-load", onFailLoad);
      webview.removeEventListener("did-start-loading", onStartLoading);
      webview.removeEventListener("did-stop-loading", onStopLoading);
    };
  }, [persistUrl]);

  const navigate = useCallback((raw: string) => {
    const webview = webviewRef.current;
    if (!webview) return;
    setLoadError(null);
    // Aborted / guard-vetoed loads already surface via did-fail-load.
    webview.loadURL(normalizeAddress(raw)).catch(() => {});
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      navigate(address);
    },
    [address, navigate],
  );

  return (
    <Flex direction="column" height="100%" className="bg-(--color-background)">
      <Flex
        align="center"
        gap="1"
        px="2"
        className="h-[36px] shrink-0 border-b border-b-(--gray-6)"
      >
        <Button
          size="icon-sm"
          aria-label="Back"
          data-attr="browser-tab-back"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Forward"
          data-attr="browser-tab-forward"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          size="icon-sm"
          aria-label={isLoading ? "Stop loading" : "Reload"}
          data-attr="browser-tab-reload"
          onClick={() =>
            isLoading
              ? webviewRef.current?.stop()
              : webviewRef.current?.reload()
          }
        >
          {isLoading ? <X size={14} /> : <ArrowClockwise size={14} />}
        </Button>
        <form onSubmit={onSubmit} className="ml-1 flex-1">
          <input
            aria-label="Address"
            data-attr="browser-tab-address"
            // biome-ignore lint/a11y/noAutofocus: a blank tab exists only to type a url into
            autoFocus={initialUrl.current === DEFAULT_URL}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search or enter address"
            spellCheck={false}
            className="h-[24px] w-full rounded-(--radius-2) border-0 bg-(--gray-3) px-2 text-(--gray-12) text-[12px] outline-none focus:bg-(--gray-4)"
          />
        </form>
      </Flex>

      <Box flexGrow="1" position="relative" className="overflow-hidden">
        <div
          className={
            isLoading
              ? "quill-section-loading quill-section-loading--active"
              : "quill-section-loading"
          }
        />
        {loadError && (
          <Flex
            direction="column"
            align="center"
            justify="center"
            gap="2"
            className="absolute inset-0 z-10 bg-(--gray-2)"
          >
            <Globe size={24} className="text-gray-10" />
            <Text color="gray" className="text-sm">
              {loadError}
            </Text>
          </Flex>
        )}
        {/* Shared persisted profile across all browser tabs/tasks is intentional
            (stay logged in to e.g. GitHub); trade-off: shared cookies/storage.
            No `allowpopups` — popups are denied and routed to the OS browser by
            the guest's window-open handler (window.ts). */}
        <webview
          ref={webviewRef as React.Ref<HTMLElement>}
          src={initialUrl.current}
          partition="persist:browser"
          style={{ height: "100%", width: "100%" }}
        />
      </Box>
    </Flex>
  );
}
