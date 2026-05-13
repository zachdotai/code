import { Text } from "@components/text";
import { CircleIcon, FunnelSimple } from "phosphor-react-native";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUserQuery } from "@/features/auth";
import { useThemeColors } from "@/lib/theme";
import {
  type OrganizeMode,
  type SortMode,
  useTaskStore,
} from "../stores/taskStore";

interface MenuSectionProps {
  title: string;
  children: React.ReactNode;
}

function MenuSection({ title, children }: MenuSectionProps) {
  return (
    <View className="px-1 py-2">
      <Text
        className="px-3 pb-1.5 font-medium text-[11px] text-gray-10 uppercase"
        style={{ letterSpacing: 0.5 }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

interface RadioRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function RadioRow({ label, selected, onPress }: RadioRowProps) {
  const themeColors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2.5 rounded-md px-2.5 py-2 ${
        selected ? "bg-gray-3" : "active:bg-gray-2"
      }`}
    >
      <View className="h-5 w-5 items-center justify-center">
        {selected ? (
          <View className="h-4 w-4 items-center justify-center rounded-full bg-accent-9">
            <View className="h-1.5 w-1.5 rounded-full bg-accent-contrast" />
          </View>
        ) : (
          <CircleIcon size={16} color={themeColors.gray[8]} />
        )}
      </View>
      <Text className="flex-1 text-[14px] text-gray-12">{label}</Text>
    </Pressable>
  );
}

interface TaskFilterMenuProps {
  open: boolean;
  onClose: () => void;
}

export function TaskFilterMenu({ open, onClose }: TaskFilterMenuProps) {
  const organizeMode = useTaskStore((s) => s.organizeMode);
  const setOrganizeMode = useTaskStore((s) => s.setOrganizeMode);
  const sortMode = useTaskStore((s) => s.sortMode);
  const setSortMode = useTaskStore((s) => s.setSortMode);
  const showInternal = useTaskStore((s) => s.showInternal);
  const setShowInternal = useTaskStore((s) => s.setShowInternal);
  const { data: userData } = useUserQuery();
  const isStaff = userData?.is_staff === true;
  const insets = useSafeAreaInsets();

  const pickOrganize = (mode: OrganizeMode) => {
    setOrganizeMode(mode);
  };
  const pickSort = (mode: SortMode) => {
    setSortMode(mode);
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop dismisses the menu */}
      <Pressable className="flex-1" onPress={onClose}>
        {/* noop onPress so taps inside the menu don't bubble to the backdrop */}
        <Pressable
          onPress={() => {}}
          className="absolute right-3 w-64 overflow-hidden rounded-xl border border-gray-6 bg-background"
          style={{
            top: insets.top + 64,
            shadowColor: "#000",
            shadowOpacity: 0.12,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <MenuSection title="Organize">
            <RadioRow
              label="By project"
              selected={organizeMode === "by-project"}
              onPress={() => pickOrganize("by-project")}
            />
            <RadioRow
              label="Chronological list"
              selected={organizeMode === "chronological"}
              onPress={() => pickOrganize("chronological")}
            />
          </MenuSection>

          <View className="mx-3 border-gray-6 border-t" />

          <MenuSection title="Sort by">
            <RadioRow
              label="Created"
              selected={sortMode === "created"}
              onPress={() => pickSort("created")}
            />
            <RadioRow
              label="Updated"
              selected={sortMode === "updated"}
              onPress={() => pickSort("updated")}
            />
          </MenuSection>

          {isStaff ? (
            <>
              <View className="mx-3 border-gray-6 border-t" />
              <MenuSection title="Task visibility">
                <RadioRow
                  label="External"
                  selected={!showInternal}
                  onPress={() => setShowInternal(false)}
                />
                <RadioRow
                  label="Internal"
                  selected={showInternal}
                  onPress={() => setShowInternal(true)}
                />
              </MenuSection>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface TaskFilterButtonProps {
  onPress: () => void;
}

export function TaskFilterButton({ onPress }: TaskFilterButtonProps) {
  const themeColors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-9 w-9 items-center justify-center rounded-md border border-gray-6 bg-gray-2 active:bg-gray-3"
      accessibilityLabel="Filter tasks"
      accessibilityRole="button"
    >
      <FunnelSimple size={16} color={themeColors.gray[11]} />
    </Pressable>
  );
}

export function useTaskFilterMenu() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
  };
}
