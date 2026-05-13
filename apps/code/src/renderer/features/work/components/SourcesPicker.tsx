import { ServerIcon } from "@features/mcp-servers/components/parts/icons";
import { useMcpServers } from "@features/mcp-servers/hooks/useMcpServers";
import { ArrowRight, Check } from "@phosphor-icons/react";
import { Box, Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useMemo } from "react";

interface SourcesPickerProps {
  /** MCP template ids the user has selected. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Called when the user clicks the "Connect data sources" affordance. The
   * caller is responsible for persisting any in-progress draft before
   * navigating away. */
  onConnectMore: () => void;
}

interface SourceOption {
  id: string;
  label: string;
  iconKey: string | null | undefined;
  installed: boolean;
}

export function SourcesPicker({
  value,
  onChange,
  onConnectMore,
}: SourcesPickerProps) {
  const { servers, installedTemplateIds } = useMcpServers();

  const options = useMemo<SourceOption[]>(() => {
    if (!servers) return [];
    return servers
      .map<SourceOption>((s) => ({
        id: s.id,
        label: s.name,
        iconKey: s.icon_key,
        installed: installedTemplateIds.has(s.id),
      }))
      .sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 24);
  }, [servers, installedTemplateIds]);

  const selected = useMemo(() => new Set(value), [value]);
  const hasUninstalled = options.some((o) => !o.installed);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  if (options.length === 0) {
    return (
      <Flex direction="column" gap="2">
        <Text size="1" weight="medium" className="text-(--gray-11)">
          Data sources
        </Text>
        <Text size="1" className="text-(--gray-10)">
          No data sources available. Connect one from the MCP servers screen.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        <Text size="1" weight="medium" className="text-(--gray-11)">
          Data sources
        </Text>
        <Text size="1" className="text-(--gray-10)">
          Pick which connected tools the agent should reach for. If none are
          picked, the agent decides.
        </Text>
      </Flex>

      <Flex gap="2" wrap="wrap">
        {options.map((option) => {
          const isSelected = selected.has(option.id);
          // Selected-but-uninstalled (e.g. a saved task whose source got
          // uninstalled) stays clickable so the user can remove it.
          const isInteractive = option.installed || isSelected;
          const chip = (
            <button
              type="button"
              onClick={isInteractive ? () => toggle(option.id) : undefined}
              disabled={!isInteractive}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                isInteractive ? "cursor-pointer" : "cursor-not-allowed"
              } ${
                isSelected
                  ? option.installed
                    ? "border-(--accent-7) bg-(--accent-3) text-(--gray-12)"
                    : "border-(--amber-7) bg-(--amber-3) text-(--gray-12)"
                  : option.installed
                    ? "border-(--gray-5) bg-(--gray-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
                    : "border-(--gray-4) bg-(--gray-1) text-(--gray-9) opacity-70"
              }`}
            >
              <Box className="shrink-0">
                <ServerIcon iconKey={option.iconKey} size={14} />
              </Box>
              <Text size="1">{option.label}</Text>
              {isSelected && <Check size={12} />}
            </button>
          );

          if (option.installed) return <Box key={option.id}>{chip}</Box>;

          const tooltipContent = isSelected
            ? "Saved but not connected — click to remove, or connect it from MCP servers."
            : "Not connected. Connect this from the MCP servers screen first.";

          return (
            <Tooltip key={option.id} content={tooltipContent}>
              <span>{chip}</span>
            </Tooltip>
          );
        })}
      </Flex>

      {hasUninstalled && (
        <Flex>
          <Button size="1" variant="ghost" color="gray" onClick={onConnectMore}>
            Connect data sources
            <ArrowRight size={12} />
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
