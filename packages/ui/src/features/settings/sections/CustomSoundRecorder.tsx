import { Microphone, Stop, Trash } from "@phosphor-icons/react";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Keep recordings short so the data URL stays small enough to persist in settings.
const MAX_RECORDING_MS = 5000;

export function CustomSoundRecorder() {
  const customCompletionSound = useSettingsStore(
    (s) => s.customCompletionSound,
  );
  const setCustomCompletionSound = useSettingsStore(
    (s) => s.setCustomCompletionSound,
  );

  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecording = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone access denied", {
        description:
          "Allow microphone access for PostHog Code in System Settings > Privacy & Security > Microphone.",
      });
      return;
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      setIsRecording(false);
      const blob = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      const reader = new FileReader();
      reader.onloadend = () => {
        setCustomCompletionSound(
          typeof reader.result === "string" ? reader.result : null,
        );
      };
      reader.readAsDataURL(blob);
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    stopTimeoutRef.current = setTimeout(stopRecording, MAX_RECORDING_MS);
  }, [setCustomCompletionSound, stopRecording]);

  // Stop any in-flight recording and release the mic if the view unmounts.
  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    };
  }, []);

  return (
    <Flex align="center" gap="2">
      {isRecording ? (
        <Button color="red" variant="soft" size="1" onClick={stopRecording}>
          <Stop weight="fill" size={12} />
          Stop
        </Button>
      ) : (
        <Button variant="soft" size="1" onClick={startRecording}>
          <Microphone size={12} />
          {customCompletionSound ? "Re-record" : "Record"}
        </Button>
      )}
      {customCompletionSound && !isRecording && (
        <Button
          variant="ghost"
          color="gray"
          size="1"
          onClick={() => setCustomCompletionSound(null)}
        >
          <Trash size={12} />
          Clear
        </Button>
      )}
      {!customCompletionSound && !isRecording && (
        <Text color="gray" className="text-[13px]">
          No recording yet
        </Text>
      )}
    </Flex>
  );
}
