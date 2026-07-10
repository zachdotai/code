import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { getPaneHistoryTracker } from "./createAppRouter";

/**
 * Back/forward availability + actions for the pane router in context. In the
 * shell that context is the FOCUSED pane's router (via AppShell's
 * RouterContextProvider), so the title-bar buttons drive whichever pane the
 * user is working in — and survive focus swaps, because the forward tracker
 * lives with each router (see createAppRouter), not in component state.
 */
export function usePaneHistoryControls() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const tracker = useMemo(() => getPaneHistoryTracker(router), [router]);
  const canGoForward = useSyncExternalStore(
    tracker.subscribe,
    tracker.canGoForward,
  );
  return {
    canGoBack,
    canGoForward,
    back: () => router.history.back(),
    forward: () => router.history.forward(),
  };
}
