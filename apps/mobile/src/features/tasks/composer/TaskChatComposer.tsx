import * as Haptics from "expo-haptics";
import {
  ArrowUp,
  BrainIcon,
  Microphone,
  PaperclipIcon,
  PauseIcon,
  PencilIcon,
  Robot,
  ShieldCheck,
  Stop,
} from "phosphor-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useVoiceRecording } from "@/features/chat";
import { useThemeColors } from "@/lib/theme";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  EXECUTION_MODES,
  type ExecutionMode,
  MODELS,
  modeLabel,
  modelLabel,
  modelSupportsReasoning,
  REASONING_LEVELS,
  type ReasoningEffort,
  reasoningLabel,
} from "./options";
import { Pill } from "./Pill";
import { SelectSheet } from "./SelectSheet";

interface TaskChatComposerProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  isUserTurn?: boolean;
  /** Current pill values (persisted per-task by the caller). */
  mode: ExecutionMode;
  model: string;
  reasoning: ReasoningEffort;
  onModeChange: (mode: ExecutionMode) => void;
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: ReasoningEffort) => void;
}

function modeIcon(mode: ExecutionMode, color: string, size = 14): ReactNode {
  switch (mode) {
    case "plan":
      return <PauseIcon size={size} color={color} weight="bold" />;
    case "default":
      return <PencilIcon size={size} color={color} />;
    case "acceptEdits":
      return <ShieldCheck size={size} color={color} />;
  }
}

function PulsingBorder({ active, color }: { active: boolean; color: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      opacity.setValue(0);
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      animRef.current = null;
      opacity.setValue(0);
    }
    return () => {
      animRef.current?.stop();
    };
  }, [active, opacity]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity,
        borderWidth: 2,
        borderColor: color,
        borderRadius: 16,
      }}
    />
  );
}

export function TaskChatComposer({
  onSend,
  onStop,
  disabled = false,
  placeholder = "Ask a question",
  isUserTurn = false,
  mode,
  model,
  reasoning,
  onModeChange,
  onModelChange,
  onReasoningChange,
}: TaskChatComposerProps) {
  const themeColors = useThemeColors();
  const [message, setMessage] = useState("");
  const { status, startRecording, stopRecording, cancelRecording } =
    useVoiceRecording();

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";

  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false);

  const showReasoningPill = modelSupportsReasoning(model);

  const canSend = message.trim().length > 0 && !disabled && !isRecording;
  const showStop =
    !isUserTurn && !canSend && !isRecording && !isTranscribing && !!onStop;

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    setMessage("");
    Keyboard.dismiss();
    onSend(trimmed);
  };

  const handleMicPress = async () => {
    if (isRecording) {
      const transcript = await stopRecording();
      if (transcript) {
        setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    } else if (!isTranscribing) {
      await startRecording();
    }
  };

  const handleMicLongPress = async () => {
    if (isRecording) {
      await cancelRecording();
    }
  };

  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStop?.();
  };

  return (
    <>
      <View className="px-3">
        <View className="relative">
          <PulsingBorder active={isUserTurn} color={themeColors.accent[9]} />
          <View className="overflow-hidden rounded-2xl border border-gray-6 bg-card">
            <TextInput
              className="px-4 pt-3.5 pb-3 text-[15px] text-gray-12"
              style={{ minHeight: 56, maxHeight: 200 }}
              placeholder={
                isRecording
                  ? "Recording..."
                  : isTranscribing
                    ? "Transcribing..."
                    : placeholder
              }
              placeholderTextColor={themeColors.gray[9]}
              value={message}
              onChangeText={setMessage}
              editable={!disabled && !isRecording}
              multiline
              textAlignVertical="top"
            />

            <View className="flex-row items-center gap-2 px-2 pb-2">
              <Pressable
                hitSlop={8}
                onPress={() => {
                  /* attachments — coming soon */
                }}
                className="h-9 w-9 items-center justify-center"
              >
                <PaperclipIcon size={18} color={themeColors.gray[10]} />
              </Pressable>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                className="flex-1"
                contentContainerStyle={{
                  alignItems: "center",
                  gap: 6,
                  paddingRight: 4,
                }}
              >
                <Pill
                  icon={modeIcon(
                    mode,
                    mode === "plan"
                      ? themeColors.accent[11]
                      : themeColors.gray[11],
                  )}
                  label={modeLabel(mode)}
                  accent={mode === "plan"}
                  onPress={() => setModeSheetOpen(true)}
                />

                <Pill
                  icon={<Robot size={14} color={themeColors.gray[11]} />}
                  label={modelLabel(model)}
                  onPress={() => setModelSheetOpen(true)}
                />

                {showReasoningPill ? (
                  <Pill
                    icon={<BrainIcon size={14} color={themeColors.gray[11]} />}
                    label={reasoningLabel(reasoning)}
                    onPress={() => setReasoningSheetOpen(true)}
                  />
                ) : null}
              </ScrollView>

              <Pressable
                onPress={
                  canSend ? handleSend : showStop ? handleStop : handleMicPress
                }
                onLongPress={handleMicLongPress}
                disabled={isTranscribing || disabled}
                className={`h-9 w-9 items-center justify-center rounded-lg ${
                  canSend ? "bg-gray-12" : "bg-gray-3"
                }`}
              >
                {isTranscribing ? (
                  <ActivityIndicator
                    size="small"
                    color={themeColors.gray[12]}
                  />
                ) : canSend ? (
                  <ArrowUp
                    size={18}
                    color={themeColors.background}
                    weight="bold"
                  />
                ) : isRecording || showStop ? (
                  <Stop
                    size={18}
                    color={themeColors.status.error}
                    weight="fill"
                  />
                ) : (
                  <Microphone size={18} color={themeColors.gray[12]} />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <SelectSheet
        open={modeSheetOpen}
        title="Execution mode"
        value={mode}
        onChange={(v) => onModeChange(v as ExecutionMode)}
        onClose={() => setModeSheetOpen(false)}
        options={EXECUTION_MODES.map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: modeIcon(
            m.value,
            m.value === "plan" ? themeColors.accent[11] : themeColors.gray[11],
            16,
          ),
        }))}
      />

      <SelectSheet
        open={modelSheetOpen}
        title="Model"
        value={model}
        onChange={(v) => {
          onModelChange(v);
          // If the new model doesn't support reasoning, drop the level so the
          // payload stays consistent. Default reasoning re-applies when
          // switching back to a reasoning-capable model.
          if (!modelSupportsReasoning(v)) {
            onReasoningChange(DEFAULT_REASONING);
          }
        }}
        onClose={() => setModelSheetOpen(false)}
        options={MODELS.map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: <Robot size={16} color={themeColors.gray[11]} />,
        }))}
      />

      <SelectSheet
        open={reasoningSheetOpen}
        title="Reasoning"
        value={reasoning}
        onChange={(v) => onReasoningChange(v as ReasoningEffort)}
        onClose={() => setReasoningSheetOpen(false)}
        options={REASONING_LEVELS.map((r) => ({
          value: r.value,
          label: r.label,
          icon: <BrainIcon size={16} color={themeColors.gray[11]} />,
        }))}
      />
    </>
  );
}

export const TASK_CHAT_DEFAULTS = {
  mode: DEFAULT_EXECUTION_MODE,
  model: DEFAULT_MODEL,
  reasoning: DEFAULT_REASONING,
} as const;
