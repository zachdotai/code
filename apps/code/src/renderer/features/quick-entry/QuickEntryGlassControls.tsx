import type { SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import {
  CaretDown,
  Folder as FolderIcon,
  GitBranch,
} from "@phosphor-icons/react";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { useFolders } from "@posthog/ui/features/folders/useFolders";
import type { AgentAdapter } from "@posthog/ui/features/settings/settingsStore";
import { trpcClient } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import type { MouseEvent, ReactNode } from "react";

export function Keycap({ children }: { children: ReactNode }) {
  return <span className="qe-keycap">{children}</span>;
}

interface NativeMenuItem {
  type?: "item" | "separator" | "header";
  id?: string;
  label?: string;
  checked?: boolean;
  enabled?: boolean;
}

/**
 * Pickers open native NSMenus (via the main process) instead of in-page
 * popovers: the vibrancy window hugs the panel, and any in-page popover
 * would force the window to grow — which paints a slab of raw material.
 * Native menus float outside the window and match the macOS glass look.
 */
async function showNativeMenu(
  anchor: HTMLElement,
  items: NativeMenuItem[],
): Promise<string | null> {
  const rect = anchor.getBoundingClientRect();
  return trpcClient.quickEntry.showMenu.mutate({
    items,
    x: Math.round(rect.left),
    y: Math.round(rect.bottom + 4),
  });
}

function anchorOf(event: MouseEvent): HTMLElement {
  return event.currentTarget as HTMLElement;
}

interface GlassChipContentProps {
  icon: ReactNode;
  label: string;
  chevron?: boolean;
}

function GlassChipContent({
  icon,
  label,
  chevron = true,
}: GlassChipContentProps) {
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

/** Toolbar picker: chip-style trigger + native menu with a check on the
 * selected item. Groups render as native section headers (model picker). */
export function GlassSelect({
  icon,
  label,
  items,
  groups,
  currentValue,
  onSelect,
  disabled,
  accented,
  adapter,
  onAdapterChange,
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
  /** When set, appends a "Switch to <other adapter>" item. */
  adapter?: AgentAdapter;
  onAdapterChange?: (adapter: AgentAdapter) => void;
  "aria-label"?: string;
}) {
  const ADAPTER_SWITCH_ID = "__switch-adapter";
  const otherAdapter: AgentAdapter = adapter === "claude" ? "codex" : "claude";

  const handleOpen = async (event: MouseEvent<HTMLButtonElement>) => {
    const menuItems: NativeMenuItem[] = [];
    if (groups && groups.length > 0) {
      groups.forEach((group, index) => {
        if (index > 0) menuItems.push({ type: "separator" });
        menuItems.push({ type: "header", label: group.name });
        for (const option of group.options) {
          menuItems.push({
            id: option.value,
            label: option.name,
            checked: option.value === currentValue,
          });
        }
      });
    } else {
      for (const option of items) {
        menuItems.push({
          id: option.value,
          label: option.name,
          checked: option.value === currentValue,
        });
      }
    }
    if (adapter && onAdapterChange) {
      menuItems.push({ type: "separator" });
      menuItems.push({
        id: ADAPTER_SWITCH_ID,
        label: `Switch to ${otherAdapter === "claude" ? "Claude Code" : "Codex"}`,
      });
    }
    const selected = await showNativeMenu(anchorOf(event), menuItems);
    if (!selected) return;
    if (selected === ADAPTER_SWITCH_ID) {
      onAdapterChange?.(otherAdapter);
    } else {
      onSelect(selected);
    }
  };

  return (
    <button
      type="button"
      className="qe-chip !border-transparent !bg-transparent !font-sans !text-[12px]"
      style={accented ? { color: "var(--qe-accent-text)" } : undefined}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      aria-haspopup="menu"
      onClick={(event) => void handleOpen(event)}
    >
      <GlassChipContent icon={icon} label={label} />
    </button>
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
  const OPEN_FOLDER_ID = "__open-folder";
  const hostTrpcClient = useHostTRPCClient();
  const {
    getRecentFolders,
    getFolderDisplayName,
    addFolder,
    updateLastAccessed,
    getFolderByPath,
  } = useFolders();

  const recentFolders = getRecentFolders();
  const displayValue = getFolderDisplayName(value) || "Select repo";

  const handleOpen = async (event: MouseEvent<HTMLButtonElement>) => {
    const menuItems: NativeMenuItem[] = [];
    if (recentFolders.length > 0) {
      menuItems.push({ type: "header", label: "Recent" });
      for (const folder of recentFolders) {
        menuItems.push({
          id: folder.path,
          label: folder.name,
          checked: folder.path === value,
        });
      }
      menuItems.push({ type: "separator" });
    }
    menuItems.push({ id: OPEN_FOLDER_ID, label: "Open folder…" });

    const selected = await showNativeMenu(anchorOf(event), menuItems);
    if (!selected) return;
    if (selected === OPEN_FOLDER_ID) {
      const selectedPath = await hostTrpcClient.os.selectDirectory.query();
      if (!selectedPath) return;
      await addFolder(selectedPath);
      onChange(selectedPath);
      return;
    }
    onChange(selected);
    const folder = getFolderByPath(selected);
    if (folder) updateLastAccessed(folder.id);
  };

  return (
    <button
      type="button"
      className="qe-chip"
      disabled={disabled}
      aria-label="Repository"
      aria-haspopup="menu"
      onClick={(event) => void handleOpen(event)}
    >
      <GlassChipContent icon={<FolderIcon size={12} />} label={displayValue} />
    </button>
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

  const effectiveBranch = selectedBranch ?? defaultBranch;
  const displayed =
    (isSelectionMode ? effectiveBranch : currentBranch) ?? "no branch";

  const handleOpen = async (event: MouseEvent<HTMLButtonElement>) => {
    const menuItems: NativeMenuItem[] = [
      { type: "header", label: "Base branch" },
      ...branches.map((branch) => ({
        id: branch,
        label: branch,
        checked: branch === effectiveBranch,
      })),
    ];
    const selected = await showNativeMenu(anchorOf(event), menuItems);
    if (selected) onBranchSelect(selected);
  };

  return (
    <button
      type="button"
      className="qe-chip"
      disabled={disabled || !isSelectionMode || !repoPath}
      aria-label="Branch"
      aria-haspopup="menu"
      onClick={(event) => void handleOpen(event)}
    >
      <GlassChipContent
        icon={<GitBranch size={12} />}
        label={displayed}
        chevron={isSelectionMode}
      />
    </button>
  );
}
