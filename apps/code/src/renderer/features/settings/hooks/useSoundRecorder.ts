import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const log = logger.scope("useSoundRecorder");

const MAX_RECORDING_MS = 10_000;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface SoundRecorder {
  isRecording: boolean;
  hasRecording: boolean;
  start: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useSoundRecorder(): SoundRecorder {
  const customCompletionSound = useSettingsStore(
    (s) => s.customCompletionSound,
  );
  const setCustomCompletionSound = useSettingsStore(
    (s) => s.setCustomCompletionSound,
  );

  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    try {
      // Trigger macOS prompt up front when status is unknown. In dev mode this
      // can be flaky (adhoc-signed Electron); the getUserMedia call below will
      // re-trigger the prompt if needed and the catch handles denial cleanly.
      const status = await trpcClient.os.getMicrophoneAccessStatus.query();
      log.info("Microphone status", { status });
      if (status === "not-determined") {
        await trpcClient.os.requestMicrophoneAccess.mutate();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        log.info("Recording stopped", {
          blobSize: blob.size,
          blobType: blob.type,
          chunkCount: chunksRef.current.length,
        });
        cleanup();
        setIsRecording(false);
        if (blob.size === 0) {
          toast.error("Recording was empty");
          return;
        }
        try {
          const dataUrl = await blobToDataUrl(blob);
          log.info("Recording saved", { dataUrlLength: dataUrl.length });
          setCustomCompletionSound(dataUrl);
        } catch (error) {
          log.error("Failed to encode recording", error);
          toast.error("Could not save recording");
        }
      };

      recorder.start();
      setIsRecording(true);
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
          toast.error(`Recording capped at ${MAX_RECORDING_MS / 1000} seconds`);
        }
      }, MAX_RECORDING_MS);
    } catch (error) {
      log.error("Failed to start recording", error);
      cleanup();
      setIsRecording(false);
      const isPermissionError =
        error instanceof Error &&
        (error.name === "NotAllowedError" ||
          error.name === "SecurityError" ||
          error.message.toLowerCase().includes("permission"));
      if (isPermissionError) {
        toast.error("Microphone access denied", {
          description:
            "Enable microphone access for PostHog Code in System Settings.",
          action: {
            label: "Open Settings",
            onClick: () =>
              trpcClient.os.openExternal.mutate({
                url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
              }),
          },
        });
      } else {
        toast.error("Could not start recording");
      }
    }
  }, [cleanup, setCustomCompletionSound]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const clear = useCallback(() => {
    setCustomCompletionSound(null);
  }, [setCustomCompletionSound]);

  return {
    isRecording,
    hasRecording: customCompletionSound !== null,
    start,
    stop,
    clear,
  };
}
