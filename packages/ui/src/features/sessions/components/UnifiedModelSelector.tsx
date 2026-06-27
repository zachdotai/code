import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
} from "@agentclientprotocol/sdk";
import {
  ArrowsClockwise,
  CaretDown,
  Code,
  Cpu,
  Robot,
  Spinner,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { flattenSelectOptions } from "@posthog/ui/features/sessions/sessionStore";
import type { AgentAdapter } from "@posthog/ui/features/settings/settingsStore";
import { Fragment, useMemo, useRef, useState } from "react";

/** Gates the opencode harness (GLM). Auto-on in dev; off for everyone else. */
const OPENCODE_FLAG = "posthog-code-opencode-harness";

const ADAPTER_ICONS: Record<AgentAdapter, React.ReactNode> = {
  claude: <Robot size={14} weight="regular" />,
  codex: <Cpu size={14} weight="regular" />,
  opencode: <Code size={14} weight="regular" />,
};

const ADAPTER_LABELS: Record<AgentAdapter, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};

const ALL_ADAPTERS: AgentAdapter[] = ["claude", "codex", "opencode"];

interface UnifiedModelSelectorProps {
  modelOption?: SessionConfigOption;
  adapter: AgentAdapter;
  onAdapterChange: (adapter: AgentAdapter) => void;
  onModelChange?: (model: string) => void;
  disabled?: boolean;
  isConnecting?: boolean;
}

export function UnifiedModelSelector({
  modelOption,
  adapter,
  onAdapterChange,
  onModelChange,
  disabled,
  isConnecting,
}: UnifiedModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const pendingValueRef = useRef<string | null>(null);
  const selectOption = modelOption?.type === "select" ? modelOption : undefined;
  const options = selectOption
    ? flattenSelectOptions(selectOption.options)
    : [];
  const groupedOptions = useMemo(() => {
    if (!selectOption || selectOption.options.length === 0) return [];
    if ("group" in selectOption.options[0]) {
      return selectOption.options as SessionConfigSelectGroup[];
    }
    return [];
  }, [selectOption]);

  const currentValue = selectOption?.currentValue;
  const currentLabel =
    options.find((opt) => opt.value === currentValue)?.name ?? currentValue;

  // opencode is gated behind a flag; never offer switching to it when off.
  const opencodeEnabled = useFeatureFlag(OPENCODE_FLAG) || import.meta.env.DEV;
  const switchableAdapters = ALL_ADAPTERS.filter(
    (a) => a !== adapter && (a !== "opencode" || opencodeEnabled),
  );

  if (isConnecting) {
    return (
      <Button type="button" variant="default" size="sm" disabled>
        <Spinner size={12} className="animate-spin" />
        Loading...
      </Button>
    );
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && pendingValueRef.current !== null) {
          onModelChange?.(pendingValueRef.current);
          pendingValueRef.current = null;
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled}
            aria-label="Model"
          >
            <span className="text-muted-foreground">
              {ADAPTER_ICONS[adapter]}
            </span>
            {currentLabel ?? "Model"}
            <CaretDown
              size={10}
              weight="bold"
              className="text-muted-foreground"
            />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-[220px]"
      >
        <MenuLabel>{ADAPTER_LABELS[adapter]}</MenuLabel>
        <DropdownMenuRadioGroup
          value={currentValue ?? ""}
          onValueChange={(value) => {
            pendingValueRef.current = value;
            setOpen(false);
          }}
        >
          {groupedOptions.length > 0
            ? groupedOptions.map((group, index) => (
                <Fragment key={group.group}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <MenuLabel>{group.name}</MenuLabel>
                  {group.options.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.value}
                      value={model.value}
                    >
                      <span className="whitespace-nowrap">{model.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))
            : options.map((model) => (
                <DropdownMenuRadioItem key={model.value} value={model.value}>
                  <span className="whitespace-nowrap">{model.name}</span>
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        {switchableAdapters.map((a) => (
          <DropdownMenuItem key={a} onClick={() => onAdapterChange(a)}>
            <ArrowsClockwise size={12} weight="bold" />
            Switch to {ADAPTER_LABELS[a]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
