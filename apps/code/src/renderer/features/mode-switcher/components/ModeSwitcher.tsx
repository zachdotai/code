import { Box, Flex } from "@radix-ui/themes";
import { type AppMode, useNavigationStore } from "@stores/navigationStore";

const MODES: { value: AppMode; label: string }[] = [
  { value: "code", label: "Code" },
  { value: "work", label: "Work" },
  { value: "chat", label: "Chat" },
];

export function ModeSwitcher() {
  const mode = useNavigationStore((s) => s.mode);
  const setMode = useNavigationStore((s) => s.setMode);

  return (
    <Box p="2" className="shrink-0 border-(--gray-6) border-b">
      <Flex
        align="center"
        gap="1"
        className="rounded-(--radius-2) bg-(--gray-3) p-1"
      >
        {MODES.map((m) => {
          const isActive = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`flex-1 cursor-pointer rounded-(--radius-1) py-1 text-center font-medium text-[13px] transition-colors ${
                isActive
                  ? "bg-(--color-panel-solid) text-(--gray-12) shadow-sm"
                  : "text-(--gray-11) hover:text-(--gray-12)"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </Flex>
    </Box>
  );
}
