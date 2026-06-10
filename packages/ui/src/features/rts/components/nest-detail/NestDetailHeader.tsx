import { ArrowsOutCardinal } from "@phosphor-icons/react";
import { useFunSpeak } from "@posthog/ui/features/fun-mode/hooks/useFunSpeak";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { selectHedgehogState, useNestStore } from "../../stores/nestStore";
import { CommandConsole } from "../CommandConsole";

interface NestDetailHeaderProps {
  nestId: string;
  title: string;
  onClose: () => void;
  onRelocate?: () => void;
  disabled: boolean;
}

export function NestDetailHeader({
  nestId,
  title,
  onClose,
  onRelocate,
  disabled,
}: NestDetailHeaderProps) {
  const t = useFunSpeak();
  const hedgehogState = useNestStore(selectHedgehogState(nestId));

  return (
    <CommandConsole.Header
      eyebrow={
        <span className="flex items-center gap-2">
          {t("Nest")}
          {hedgehogState?.state === "ticking" && (
            <span className="flex items-center gap-1 rounded-full bg-(--amber-a3) px-2 py-0.5 text-(--amber-11) text-[10px] normal-case tracking-normal">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--amber-9)" />
              {t("Hedgehog ticking…")}
            </span>
          )}
        </span>
      }
      title={title}
      onClose={onClose}
      trailing={
        onRelocate && (
          <Tooltip content={`${t("Relocate nest")} (R)`} side="top">
            <IconButton
              size="1"
              variant="soft"
              color="gray"
              onClick={onRelocate}
              disabled={disabled}
              aria-label="Relocate nest"
            >
              <ArrowsOutCardinal size={14} />
            </IconButton>
          </Tooltip>
        )
      }
    />
  );
}
