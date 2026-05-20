import { KeyHint } from "@components/ui/KeyHint";
import { useFunSpeak } from "@features/fun-mode/hooks/useFunSpeak";
import { Info, Plus } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { useHotkeys } from "react-hotkeys-hook";
import { CommandConsole } from "./CommandConsole";

interface HedgehouseCommandPanelProps {
  onSpawnWildHog: () => void;
  onClose: () => void;
}

export function HedgehouseCommandPanel({
  onSpawnWildHog,
  onClose,
}: HedgehouseCommandPanelProps) {
  const t = useFunSpeak();
  useHotkeys("w", onSpawnWildHog, [onSpawnWildHog]);
  return (
    <CommandConsole consoleKey="hedgehouse-command">
      <div className="flex items-stretch gap-3 px-3 py-2">
        <CommandConsole.Section noDivider className="min-w-[140px] pr-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-(--gray-12) text-[13px]">
              {t("Hedgehouse")}
            </span>
            <Tooltip
              content={
                <div className="flex max-w-[260px] flex-col gap-1.5">
                  <span className="font-medium">
                    Wild hoglets ship a PR and die.
                  </span>
                  <span className="text-[11px] opacity-90">
                    Use the Hedgehouse for short, one-off tasks that don't need
                    a goal.
                  </span>
                  <span className="text-[11px] opacity-90">
                    For multi-step work that needs orchestration, use the
                    Builder to create a nest.
                  </span>
                </div>
              }
            >
              <Info
                size={12}
                className="cursor-help text-(--accent-10) hover:text-(--accent-12)"
              />
            </Tooltip>
          </div>
          <span className="text-(--gray-10) text-[11px]">
            {t("One-off hoglets · no orchestration")}
          </span>
        </CommandConsole.Section>

        <CommandConsole.Section className="flex-row items-center gap-2">
          <button
            type="button"
            onClick={onSpawnWildHog}
            className="flex h-9 items-center gap-1.5 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-a3) px-3 font-medium text-(--accent-11) text-[12px] transition-colors hover:bg-(--accent-a5) hover:text-(--accent-12)"
            title="Dispatch a one-off agent from the Hedgehouse (W)"
          >
            <Plus size={14} />
            {t("Spawn wild hog")}
            <KeyHint className="ml-1">W</KeyHint>
          </button>
        </CommandConsole.Section>

        <CommandConsole.Section className="pr-1 pl-2">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-(--gray-10) text-[10px] uppercase tracking-wider hover:text-(--gray-12)"
            title="Deselect (Esc)"
          >
            Esc
          </button>
        </CommandConsole.Section>
      </div>
    </CommandConsole>
  );
}
