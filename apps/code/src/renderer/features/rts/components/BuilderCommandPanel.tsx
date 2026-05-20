import { KeyHint } from "@components/ui/KeyHint";
import { useFunSpeak } from "@features/fun-mode/hooks/useFunSpeak";
import { Info, Lightning, Plus } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { useHotkeys } from "react-hotkeys-hook";
import { CommandConsole } from "./CommandConsole";

interface BuilderCommandPanelProps {
  /** Guided path: conversational goal-writing flow → full spec. */
  onBuildNest: () => void;
  /** Simple path: one-field form → minimal nest + auto-spawned first hoglet. */
  onQuickNest: () => void;
  onClose: () => void;
}

export function BuilderCommandPanel({
  onBuildNest,
  onQuickNest,
  onClose,
}: BuilderCommandPanelProps) {
  const t = useFunSpeak();
  useHotkeys("b", onBuildNest, [onBuildNest]);
  useHotkeys("q", onQuickNest, [onQuickNest]);
  return (
    <CommandConsole consoleKey="builder-command">
      <div className="flex items-stretch gap-3 px-3 py-2">
        <CommandConsole.Section noDivider className="min-w-[120px] pr-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-(--gray-12) text-[13px]">
              {t("Builder")}
            </span>
            <Tooltip
              content={
                <div className="flex max-w-[260px] flex-col gap-1.5">
                  <span className="font-medium">
                    Nests are long-running goals.
                  </span>
                  <span className="text-[11px] opacity-90">
                    A hedgehog orchestrates the brood — coordinates hoglets,
                    tracks PR dependencies, and judges goal completion.
                  </span>
                  <span className="text-[11px] opacity-90">
                    For one-off tasks, use the Hedgehouse instead.
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
            {t("Nests for orchestrated work")}
          </span>
        </CommandConsole.Section>

        <CommandConsole.Section className="flex-row items-center gap-2">
          <button
            type="button"
            onClick={onBuildNest}
            className="flex h-9 items-center gap-1.5 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-a3) px-3 font-medium text-(--accent-11) text-[12px] transition-colors hover:bg-(--accent-a5) hover:text-(--accent-12)"
            title="Guided goal-writing flow with a clarifying question and full spec (B)"
          >
            <Plus size={14} />
            {t("Build nest")}
            <KeyHint className="ml-1">B</KeyHint>
          </button>
          <button
            type="button"
            onClick={onQuickNest}
            className="flex h-9 items-center gap-1.5 rounded-(--radius-2) border border-(--gray-6) bg-(--gray-a2) px-3 font-medium text-(--gray-12) text-[12px] transition-colors hover:bg-(--gray-a4)"
            title="Simple form + auto-spawn one hoglet (Q)"
          >
            <Lightning size={14} />
            {t("Quick nest")}
            <KeyHint className="ml-1">Q</KeyHint>
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
