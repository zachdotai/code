import { Text } from "@components/text";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { CaretLeft } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toRgba, useThemeColors } from "@/lib/theme";

interface FloatingTaskHeaderProps {
  title: string;
  subtitle?: string | null;
  /** Optional right-side action (e.g. a Local-run indicator). */
  rightSlot?: ReactNode;
}

/**
 * Floating header for the task detail screen — back arrow on the left,
 * centered title + repo subtitle, optional right slot for actions. Sits over
 * the content with a top-to-bottom fade so the scroll list disappears
 * gracefully behind it rather than getting clipped by a hard edge.
 */
export function FloatingTaskHeader({
  title,
  subtitle,
  rightSlot,
}: FloatingTaskHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  // Fade height extends past the row so content scrolling up behind the title
  // softens out instead of slamming into a hard edge.
  const fadeHeight = insets.top + 88;

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 top-0 z-10"
      style={{ height: fadeHeight }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[
          toRgba(themeColors.background, 1),
          toRgba(themeColors.background, 0.92),
          toRgba(themeColors.background, 0),
        ]}
        locations={[0, 0.65, 1]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <View
        className="flex-row items-center px-3"
        style={{ paddingTop: insets.top + 6, paddingBottom: 8 }}
      >
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          className="h-11 w-11 items-center justify-center active:opacity-60"
        >
          <CaretLeft size={22} color={themeColors.gray[12]} weight="bold" />
        </Pressable>

        <View className="min-w-0 flex-1 items-center px-2">
          <Text
            className="font-semibold text-[15px] text-gray-12"
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text className="mt-0.5 text-[12px] text-gray-10" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View className="h-11 w-11 items-center justify-end">{rightSlot}</View>
      </View>
    </View>
  );
}
