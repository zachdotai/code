import type { SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  Folder as FolderIcon,
  FolderOpen,
  GitBranch,
} from "@phosphor-icons/react";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { useFolders } from "@posthog/ui/features/folders/useFolders";
import type { AgentAdapter } from "@posthog/ui/features/settings/settingsStore";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactElement, type ReactNode } from "react";

export function Keycap({ children }: { children: ReactNode }) {
  return <span className="qe-keycap">{children}</span>;
}

interface GlassChipProps {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  chevron?: boolean;
  "aria-label"?: string;
}

function GlassChipContent({ icon, label, chevron = true }: GlassChipProps) {
  return (
    <>
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="max-w-[180px] truncate">{label}</span>
      {chevron && (
        <CaretDown size={9} weight="bold" className="shrink-0 opacity-50" />
      )}
    </>
  );
}

interface SelectItem {
  value: string;
  name: string;
}

interface GlassMenuProps {
  trigger: ReactElement;
  mono?: boolean;
  children: ReactNode;
  minWidth?: number;
}

function GlassMenu({
  trigger,
  mono,
  children,
  minWidth = 200,
}: GlassMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        data-mono={mono ? "true" : undefined}
        className="qe-menu"
        style={{ minWidth }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectableItem({
  item,
  selected,
  onSelect,
}: {
  item: SelectItem;
  selected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <DropdownMenuItem
      onClick={() => onSelect(item.value)}
      style={selected ? { color: "var(--qe-accent-text)" } : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {selected && <Check size={12} weight="bold" className="shrink-0" />}
    </DropdownMenuItem>
  );
}

/**
 * Generic toolbar picker: glass chip-style trigger + glass popover with a
 * check on the selected item. Groups render with labels (model picker).
 */
export function GlassSelect({
  icon,
  label,
  items,
  groups,
  currentValue,
  onSelect,
  disabled,
  accented,
  footer,
  "aria-label": ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  items: SelectItem[];
  groups?: SessionConfigSelectGroup[];
  currentValue: string | undefined;
  onSelect: (value: string) => void;
  disabled?: boolean;
  accented?: boolean;
  footer?: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <GlassMenu
      trigger={
        <button
          type="button"
          className="qe-chip !font-sans !text-[12px] !border-transparent !bg-transparent"
          style={accented ? { color: "var(--qe-accent-text)" } : undefined}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
        >
          <GlassChipContent icon={icon} label={label} />
        </button>
      }
    >
      {groups && groups.length > 0
        ? groups.map((group, index) => (
            <Fragment key={group.group}>
              {index > 0 && <DropdownMenuSeparator />}
              <MenuLabel>{group.name}</MenuLabel>
              {group.options.map((item) => (
                <SelectableItem
                  key={item.value}
                  item={item}
                  selected={item.value === currentValue}
                  onSelect={onSelect}
                />
              ))}
            </Fragment>
          ))
        : items.map((item) => (
            <SelectableItem
              key={item.value}
              item={item}
              selected={item.value === currentValue}
              onSelect={onSelect}
            />
          ))}
      {footer}
    </GlassMenu>
  );
}

export function AdapterSwitchItem({
  adapter,
  onAdapterChange,
}: {
  adapter: AgentAdapter;
  onAdapterChange: (adapter: AgentAdapter) => void;
}) {
  const other: AgentAdapter = adapter === "claude" ? "codex" : "claude";
  const label = other === "claude" ? "Claude Code" : "Codex";
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onAdapterChange(other)}>
        <ArrowsClockwise size={12} weight="bold" />
        Switch to {label}
      </DropdownMenuItem>
    </>
  );
}

/** Header repo picker chip: recent folders + "Open folder…". */
export function RepoChip({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
}) {
  const trpcClient = useHostTRPCClient();
  const {
    getRecentFolders,
    getFolderDisplayName,
    addFolder,
    updateLastAccessed,
    getFolderByPath,
  } = useFolders();

  const recentFolders = getRecentFolders();
  const displayValue = getFolderDisplayName(value) || "Select repo";

  const handleSelect = (path: string) => {
    onChange(path);
    const folder = getFolderByPath(path);
    if (folder) updateLastAccessed(folder.id);
  };

  const handleOpenFilePicker = async () => {
    const selectedPath = await trpcClient.os.selectDirectory.query();
    if (!selectedPath) return;
    await addFolder(selectedPath);
    onChange(selectedPath);
  };

  return (
    <GlassMenu
      mono
      trigger={
        <button
          type="button"
          className="qe-chip"
          disabled={disabled}
          aria-label="Repository"
        >
          <GlassChipContent
            icon={<FolderIcon size={12} />}
            label={displayValue}
          />
        </button>
      }
    >
      {recentFolders.length > 0 && <MenuLabel>Recent</MenuLabel>}
      {recentFolders.map((folder) => (
        <SelectableItem
          key={folder.id}
          item={{ value: folder.path, name: folder.name }}
          selected={folder.path === value}
          onSelect={handleSelect}
        />
      ))}
      {recentFolders.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onClick={() => void handleOpenFilePicker()}>
        <FolderOpen size={12} className="shrink-0" />
        Open folder...
      </DropdownMenuItem>
    </GlassMenu>
  );
}

/**
 * Header branch picker chip. In worktree mode it picks the base branch for
 * the new workspace; in local mode it just shows the checked-out branch —
 * quick entry never checks branches out from an overlay.
 */
export function BranchChip({
  repoPath,
  workspaceMode,
  currentBranch,
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  disabled,
}: {
  repoPath: string | null;
  workspaceMode: "worktree" | "local";
  currentBranch: string | null;
  defaultBranch: string | null;
  selectedBranch: string | null;
  onBranchSelect: (branch: string) => void;
  disabled?: boolean;
}) {
  const trpc = useHostTRPC();
  const isSelectionMode = workspaceMode === "worktree";

  const { data: branches = [] } = useQuery({
    ...trpc.git.getAllBranches.queryOptions({
      directoryPath: repoPath as string,
    }),
    enabled: isSelectionMode && !!repoPath,
    staleTime: 60_000,
  });

  const displayed =
    (isSelectionMode ? (selectedBranch ?? defaultBranch) : currentBranch) ??
    "no branch";

  const chip = (
    <button
      type="button"
      className="qe-chip"
      disabled={disabled || !isSelectionMode || !repoPath}
      aria-label="Branch"
    >
      <GlassChipContent
        icon={<GitBranch size={12} />}
        label={displayed}
        chevron={isSelectionMode}
      />
    </button>
  );

  if (!isSelectionMode || !repoPath) return chip;

  return (
    <GlassMenu mono trigger={chip}>
      <MenuLabel>Base branch</MenuLabel>
      {branches.map((branch) => (
        <SelectableItem
          key={branch}
          item={{ value: branch, name: branch }}
          selected={branch === (selectedBranch ?? defaultBranch)}
          onSelect={onBranchSelect}
        />
      ))}
    </GlassMenu>
  );
}
