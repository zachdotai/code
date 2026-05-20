import { logger } from "@utils/logger";
import { useCallback, useEffect } from "react";
import { useRtsViewStore } from "../stores/rtsViewStore";

const log = logger.scope("hedgemony-fullscreen");

export interface RtsFullscreen {
  fullscreen: boolean;
  exitFullscreen: () => void;
  toggleFullscreen: () => void;
  /** In-app overlay only, no OS fullscreen. For users who want to keep their
   * menu bar / dock visible while still hiding app chrome. */
  toggleInAppFullscreen: () => void;
}

/**
 * Coordinates the in-app fullscreen overlay with the browser's actual
 * fullscreen API. On macOS, in-app fullscreen alone still bleeds the OS
 * traffic lights through; OS fullscreen is the only way to hide them and
 * give players a Starcraft/AoE-style experience.
 */
export function useRtsFullscreen(): RtsFullscreen {
  const fullscreen = useRtsViewStore((s) => s.fullscreen);
  const setFullscreen = useRtsViewStore((s) => s.setFullscreen);
  const setOsFullscreen = useRtsViewStore((s) => s.setOsFullscreen);

  useEffect(() => {
    const handler = () => {
      const isOs = Boolean(document.fullscreenElement);
      const wasOs = useRtsViewStore.getState().osFullscreen;
      setOsFullscreen(isOs);
      if (wasOs && !isOs) {
        setFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [setOsFullscreen, setFullscreen]);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const exitOsFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore — fullscreenchange listener will reconcile the store.
      }
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    setFullscreen(true);
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (error) {
        log.warn("Failed to enter OS fullscreen", { error });
      }
    }
  }, [setFullscreen]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    void exitOsFullscreen();
  }, [setFullscreen, exitOsFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [fullscreen, enterFullscreen, exitFullscreen]);

  const toggleInAppFullscreen = useCallback(() => {
    if (fullscreen) {
      exitFullscreen();
    } else {
      setFullscreen(true);
    }
  }, [fullscreen, exitFullscreen, setFullscreen]);

  return {
    fullscreen,
    exitFullscreen,
    toggleFullscreen,
    toggleInAppFullscreen,
  };
}
