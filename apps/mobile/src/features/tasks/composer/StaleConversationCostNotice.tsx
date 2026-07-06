import { Warning } from "phosphor-react-native";
import { Pressable, Text, View } from "react-native";
import { formatRelativeTime } from "@/lib/format";
import { useThemeColors } from "@/lib/theme";

interface StaleConversationCostNoticeProps {
  usedTokens: number;
  lastActivityAt: number | null;
  costUsd: number | null;
  onContinue: () => void;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

/**
 * Blocking composer state shown when PostHog staff return to a large, idle
 * conversation whose prompt cache has likely expired. Replaces the prompt input
 * until the user chooses to continue.
 */
export function StaleConversationCostNotice({
  usedTokens,
  lastActivityAt,
  costUsd,
  onContinue,
}: StaleConversationCostNoticeProps) {
  const themeColors = useThemeColors();
  const activity =
    lastActivityAt !== null
      ? `was last active ${formatRelativeTime(lastActivityAt)}`
      : "has been idle";
  const spent =
    costUsd !== null ? ` (≈$${costUsd.toFixed(2)} spent so far)` : "";

  return (
    <View className="mx-3 rounded-2xl border border-accent-6 bg-accent-2 p-4">
      <View className="mb-2 flex-row items-center gap-2">
        <Warning size={16} color={themeColors.accent[9]} weight="fill" />
        <Text className="font-medium text-[15px] text-gray-12">
          Continue this large, idle conversation?
        </Text>
      </View>
      <Text className="text-[13px] text-gray-11 leading-5">
        This conversation holds about {formatTokens(usedTokens)} tokens and{" "}
        {activity}. Its prompt cache has likely expired, so the next message
        re-processes everything at full input price{spent}.
      </Text>
      <Pressable
        onPress={onContinue}
        className="mt-3 rounded-lg bg-gray-12 px-4 py-2.5 active:opacity-80"
      >
        <Text className="text-center font-medium text-background">
          Continue anyway
        </Text>
      </Pressable>
    </View>
  );
}
