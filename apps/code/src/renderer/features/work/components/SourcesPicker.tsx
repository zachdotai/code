import { ServerIcon } from "@features/mcp-servers/components/parts/icons";
import { useMcpServers } from "@features/mcp-servers/hooks/useMcpServers";
import { Check } from "@phosphor-icons/react";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useMemo } from "react";

interface SourcesPickerProps {
  /** MCP template ids the user has selected. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Called when the user clicks an uninstalled source. The caller is
   * responsible for persisting any in-progress draft before navigating to
   * the data-sources configuration screen. */
  onConfigureSource: (sourceId: string) => void;
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
  onConfigureSource,
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
          const handleClick = () => {
            if (option.installed) {
              toggle(option.id);
            } else if (isSelected) {
              // Selected-but-uninstalled: let the user remove it.
              toggle(option.id);
            } else {
              onConfigureSource(option.id);
            }
          };
          const chip = (
            <button
              type="button"
              onClick={handleClick}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                isSelected
                  ? option.installed
                    ? "border-(--accent-7) bg-(--accent-3) text-(--gray-12)"
                    : "border-(--amber-7) bg-(--amber-3) text-(--gray-12)"
                  : option.installed
                    ? "border-(--gray-5) bg-(--gray-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
                    : "border-(--gray-4) bg-(--gray-1) text-(--gray-9) opacity-70 hover:border-(--gray-6) hover:bg-(--gray-2) hover:opacity-100"
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
            ? "Saved but not connected — click to remove."
            : `Set up ${option.label} to use it`;

          return (
            <Tooltip key={option.id} content={tooltipContent}>
              <span>{chip}</span>
            </Tooltip>
          );
        })}
      </Flex>
    </Flex>
  );
}
