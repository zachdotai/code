import { Text } from "@components/text";
import { usePathname, useRouter } from "expo-router";
import { Clock, GearSix, Plus, Tray } from "phosphor-react-native";
import { type ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OFFLINE_BANNER_HEIGHT } from "@/components/OfflineBanner";
import { TaskStatusIcon } from "@/features/tasks/components/TaskStatusIcon";
import { useTasks } from "@/features/tasks/hooks/useTasks";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useThemeColors } from "@/lib/theme";
import { useNavDrawerStore } from "../stores/navDrawerStore";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(320, Math.round(SCREEN_WIDTH * 0.85));

interface DrawerItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
}

function DrawerItem({ icon, label, active, onPress }: DrawerItemProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2.5 rounded-md px-2.5 py-2.5 ${active ? "bg-gray-3" : "active:bg-gray-2"}`}
    >
      <View className="h-5 w-5 shrink-0 items-center justify-center">
        {icon}
      </View>
      <Text
        className="flex-1 font-medium text-[14px] text-gray-12"
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function NavDrawer() {
  const isOpen = useNavDrawerStore((s) => s.isOpen);
  const close = useNavDrawerStore((s) => s.close);
  const router = useRouter();
  const pathname = usePathname();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  const { tasks } = useTasks();

  const navigateTo = (target: string) => {
    close();
    if (pathname === target) return;
    router.replace(target);
  };

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Drawer is always mounted; only the animation values move. The native
    // driver runs these off the JS thread, so a press triggers the slide
    // instantly without re-rendering the (heavy) drawer subtree.
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: isOpen ? 0 : -DRAWER_WIDTH,
        duration: isOpen ? 280 : 220,
        easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: isOpen ? 1 : 0,
        duration: isOpen ? 280 : 220,
        easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen, translateX, backdropOpacity]);

  const handleNewTask = () => {
    close();
    router.push("/task");
  };

  const handleInbox = () => navigateTo("/inbox");
  const handleAutomations = () => navigateTo("/automations");
  const handleSettings = () => navigateTo("/settings");
  const handleHome = () => navigateTo("/tasks");

  const handleTaskPress = (taskId: string) => {
    close();
    router.push(`/task/${taskId}`);
  };

  const iconColor = themeColors.gray[11];
  const iconColorActive = themeColors.gray[12];
  const isOnInbox = pathname === "/inbox";
  const isOnAutomations = pathname === "/automations";
  const isOnSettings = pathname === "/settings";
  const drawerTop = isConnected ? 0 : insets.top + OFFLINE_BANNER_HEIGHT;
  const drawerPaddingTop = isConnected ? insets.top + 12 : 12;

  return (
    <View
      pointerEvents={isOpen ? "auto" : "none"}
      style={StyleSheet.absoluteFillObject}
    >
      <Animated.View
        pointerEvents={isOpen ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: "rgba(0,0,0,0.4)", opacity: backdropOpacity },
        ]}
      >
        {/* Touch-down close so the dismiss starts the moment the finger lands. */}
        <Pressable className="flex-1" onPressIn={close} />
      </Animated.View>

      <Animated.View
        className="absolute top-0 bottom-0 left-0 border-gray-6 border-r bg-gray-2"
        style={{
          top: drawerTop,
          width: DRAWER_WIDTH,
          paddingTop: drawerPaddingTop,
          paddingBottom: insets.bottom,
          transform: [{ translateX }],
        }}
      >
        <Pressable onPress={handleHome} className="px-4 pb-3 active:opacity-60">
          <Text className="font-bold text-[20px] text-gray-12">PostHog</Text>
        </Pressable>

        <View className="gap-0.5 px-2 pb-2">
          <DrawerItem
            icon={<Plus size={18} color={iconColorActive} weight="bold" />}
            label="New task"
            onPress={handleNewTask}
          />
          <DrawerItem
            icon={
              <Tray
                size={18}
                color={isOnInbox ? iconColorActive : iconColor}
                weight={isOnInbox ? "fill" : "regular"}
              />
            }
            label="Inbox"
            active={isOnInbox}
            onPress={handleInbox}
          />
          <DrawerItem
            icon={
              <Clock
                size={18}
                color={isOnAutomations ? iconColorActive : iconColor}
                weight={isOnAutomations ? "fill" : "regular"}
              />
            }
            label="Automations"
            active={isOnAutomations}
            onPress={handleAutomations}
          />
        </View>

        <View className="mx-3 mb-1 border-gray-6 border-t" />

        <View className="px-4 pt-3 pb-1.5">
          <Text
            className="font-medium text-[11px] text-gray-10 uppercase"
            style={{ letterSpacing: 0.5 }}
          >
            Tasks
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        >
          {tasks.length === 0 ? (
            <View className="px-2.5 py-2">
              <Text className="text-[13px] text-gray-10">No tasks yet</Text>
            </View>
          ) : (
            tasks.map((task) => {
              const taskHref = `/task/${task.id}`;
              const active = pathname === taskHref;
              return (
                <Pressable
                  key={task.id}
                  onPress={() => handleTaskPress(task.id)}
                  className={`flex-row items-center gap-2.5 rounded-md px-2.5 py-2 ${active ? "bg-gray-3" : "active:bg-gray-2"}`}
                >
                  <View className="h-4 w-4 shrink-0 items-center justify-center">
                    <TaskStatusIcon task={task} size={14} />
                  </View>
                  <Text
                    className="flex-1 text-[14px] text-gray-12"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {task.title}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <View className="mx-3 mt-1 border-gray-6 border-t" />

        <View className="px-2 pt-2">
          <DrawerItem
            icon={
              <GearSix
                size={18}
                color={isOnSettings ? iconColorActive : iconColor}
                weight={isOnSettings ? "fill" : "regular"}
              />
            }
            label="Settings"
            active={isOnSettings}
            onPress={handleSettings}
          />
        </View>
      </Animated.View>
    </View>
  );
}
