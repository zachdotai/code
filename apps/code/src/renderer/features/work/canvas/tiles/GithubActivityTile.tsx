import {
  ArrowsClockwise,
  GithubLogo,
  GitMerge,
  GitPullRequest,
  PencilSimple,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GithubActivityItem,
  GithubActivitySummary,
  GithubActivityTile as GithubActivityTileType,
  GithubActivityType,
  GridSize,
} from "@shared/types/work-projects";
import { openUrlInBrowser } from "@utils/browser";
import { formatRelativeTimeShort } from "@utils/time";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { TileFrame } from "../TileFrame";

interface GithubActivityTileProps {
  tile: GithubActivityTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdateConfig?: (patch: {
    repo?: { owner: string; name: string };
    enabledTypes?: GithubActivityType[];
    windowDays?: number;
  }) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

const TYPE_LABELS: Record<GithubActivityType, string> = {
  pr_merged: "PRs merged",
  pr_opened: "PRs opened",
  issue_opened: "Issues opened",
  release: "Releases",
};

const TYPE_SHORT: Record<GithubActivityType, string> = {
  pr_merged: "Merged",
  pr_opened: "Opened",
  issue_opened: "Issues",
  release: "Releases",
};

const TYPE_ICON: Record<
  GithubActivityType,
  ComponentType<{ size?: number; weight?: "duotone" | "fill" | "regular" }>
> = {
  pr_merged: GitMerge,
  pr_opened: GitPullRequest,
  issue_opened: WarningCircle,
  release: Tag,
};

const TYPE_ORDER: GithubActivityType[] = [
  "pr_merged",
  "pr_opened",
  "issue_opened",
  "release",
];

const STALE_MS = 5 * 60 * 1000;

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

function parseRepoString(raw: string): { owner: string; name: string } | null {
  const trimmed = raw.trim().replace(/^https?:\/\/github\.com\//, "");
  const match = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

export function GithubActivityTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onUpdateConfig,
  onRefresh,
}: GithubActivityTileProps) {
  const isConfigured = !!tile.repo;
  const [editing, setEditing] = useState(!isConfigured);
  const [refreshing, setRefreshing] = useState(false);
  const autoRefreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isConfigured || editing) return;
    if (!onRefresh) return;
    const key = `${tile.id}:${tile.repo?.owner}/${tile.repo?.name}:${tile.enabledTypes.join(",")}:${tile.windowDays}`;
    if (autoRefreshedFor.current === key) return;
    const fetchedAt = tile.summary?.fetchedAt
      ? new Date(tile.summary.fetchedAt).getTime()
      : 0;
    // If the last fetch errored, retry on mount regardless of recency – the
    // cause may have been transient (auth flow completed in another window,
    // network glitch, stale main-process build after a restart).
    const hadError = !!tile.summary?.error;
    if (!hadError && Date.now() - fetchedAt < STALE_MS) return;
    autoRefreshedFor.current = key;
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  }, [
    isConfigured,
    editing,
    onRefresh,
    tile.id,
    tile.repo,
    tile.enabledTypes,
    tile.windowDays,
    tile.summary?.fetchedAt,
    tile.summary?.error,
  ]);

  const repoLabel = tile.repo
    ? `${tile.repo.owner}/${tile.repo.name}`
    : "GitHub activity";

  const handleRefreshClick = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const headerStatus =
    isConfigured && !editing
      ? [
          tile.summary?.fetchedAt
            ? `Updated ${formatRelativeTimeShort(tile.summary.fetchedAt)} ago`
            : null,
          // Surface the lookback window inline so users don't have to look
          // for a separate subtitle to know what window the counts cover.
          `last ${tile.windowDays}d`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const headerAction = (
    <Flex align="center" gap="2">
      {headerStatus && (
        <Text className="text-(--gray-10) text-[10px]">{headerStatus}</Text>
      )}
      {isConfigured && !editing && onUpdateConfig && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit repo and activity"
          aria-label="Edit repo and activity"
          className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          <PencilSimple size={12} weight="duotone" />
        </button>
      )}
      {isConfigured && !editing && onRefresh && (
        <button
          type="button"
          onClick={handleRefreshClick}
          disabled={refreshing}
          title="Refresh"
          aria-label="Refresh"
          className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12) disabled:opacity-50"
        >
          <ArrowsClockwise
            size={12}
            weight="duotone"
            className={refreshing ? "animate-spin" : ""}
          />
        </button>
      )}
    </Flex>
  );

  return (
    <TileFrame
      tile={tile}
      icon={GithubLogo}
      label={repoLabel}
      headerAction={headerAction}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      {editing || !isConfigured ? (
        <ConfigForm
          tile={tile}
          canSave={!!onUpdateConfig}
          onCancel={isConfigured ? () => setEditing(false) : undefined}
          onSubmit={async (patch) => {
            if (!onUpdateConfig) return;
            await onUpdateConfig(patch);
            setEditing(false);
          }}
        />
      ) : (
        <LiveBody tile={tile} summary={tile.summary} refreshing={refreshing} />
      )}
    </TileFrame>
  );
}

interface ConfigFormProps {
  tile: GithubActivityTileType;
  canSave: boolean;
  onCancel?: () => void;
  onSubmit: (patch: {
    repo: { owner: string; name: string };
    enabledTypes: GithubActivityType[];
    windowDays: number;
  }) => Promise<void>;
}

function ConfigForm({ tile, canSave, onCancel, onSubmit }: ConfigFormProps) {
  const [repoInput, setRepoInput] = useState(
    tile.repo ? `${tile.repo.owner}/${tile.repo.name}` : "",
  );
  const [enabled, setEnabled] = useState<Set<GithubActivityType>>(
    new Set(tile.enabledTypes),
  );
  const [windowDays, setWindowDays] = useState<number>(tile.windowDays);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (t: GithubActivityType) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size === 1) return prev;
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setError(null);
    const repo = parseRepoString(repoInput);
    if (!repo) {
      setError("Use the form owner/name, e.g. PostHog/posthog.");
      return;
    }
    if (enabled.size === 0) {
      setError("Pick at least one activity type.");
      return;
    }
    const days = Math.max(1, Math.min(90, Math.round(windowDays || 7)));
    setSaving(true);
    try {
      await onSubmit({
        repo,
        enabledTypes: TYPE_ORDER.filter((t) => enabled.has(t)),
        windowDays: days,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex
      direction="column"
      gap="3"
      className="h-full min-h-0 overflow-y-auto px-4 py-3"
    >
      <Flex direction="column" gap="1">
        <Text
          as="label"
          htmlFor={`repo-${tile.id}`}
          className="text-(--gray-11) text-[11px] uppercase tracking-wide"
        >
          Repository
        </Text>
        <input
          id={`repo-${tile.id}`}
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          placeholder="owner/name (e.g. PostHog/posthog)"
          className="block w-full rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1.5 font-mono text-(--gray-12) text-[12px] outline-none placeholder:text-(--gray-9) focus:border-(--accent-7)"
        />
      </Flex>

      <Flex direction="column" gap="1">
        <Text
          as="div"
          className="text-(--gray-11) text-[11px] uppercase tracking-wide"
        >
          Activity to watch
        </Text>
        <Flex wrap="wrap" gap="1.5">
          {TYPE_ORDER.map((t) => {
            const Icon = TYPE_ICON[t];
            const on = enabled.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className={`flex items-center gap-1.5 rounded-(--radius-2) border px-2 py-1 text-[12px] transition-colors ${
                  on
                    ? "border-(--accent-7) bg-(--accent-3) text-(--accent-12)"
                    : "border-(--gray-5) bg-(--gray-1) text-(--gray-11) hover:border-(--gray-7) hover:text-(--gray-12)"
                }`}
              >
                <Icon size={12} weight="duotone" />
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </Flex>
      </Flex>

      <Flex direction="column" gap="1">
        <Text
          as="label"
          htmlFor={`window-${tile.id}`}
          className="text-(--gray-11) text-[11px] uppercase tracking-wide"
        >
          Lookback window
        </Text>
        <Flex align="center" gap="2">
          <input
            id={`window-${tile.id}`}
            type="number"
            min={1}
            max={90}
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="block w-20 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2 py-1 text-(--gray-12) text-[12px] outline-none focus:border-(--accent-7)"
          />
          <Text className="text-(--gray-11) text-[12px]">days</Text>
        </Flex>
      </Flex>

      {error && <Text className="text-(--red-11) text-[11px]">{error}</Text>}

      <Flex align="center" gap="2" className="mt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSave || saving}
          className="rounded-(--radius-2) bg-(--accent-9) px-3 py-1.5 text-[12px] text-white transition-colors hover:bg-(--accent-10) disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : tile.repo ? "Save" : "Watch repo"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-(--radius-2) px-2 py-1.5 text-(--gray-11) text-[12px] hover:bg-(--gray-3) hover:text-(--gray-12)"
          >
            Cancel
          </button>
        )}
      </Flex>
    </Flex>
  );
}

interface LiveBodyProps {
  tile: GithubActivityTileType;
  summary?: GithubActivitySummary;
  refreshing: boolean;
}

function LiveBody({ tile, summary, refreshing }: LiveBodyProps) {
  const enabled = tile.enabledTypes;

  if (!summary && refreshing) {
    return (
      <Flex
        align="center"
        justify="center"
        className="h-full text-(--gray-10) text-[12px]"
      >
        Loading activity…
      </Flex>
    );
  }

  if (!summary) {
    return (
      <Flex
        align="center"
        justify="center"
        className="h-full text-(--gray-10) text-[12px]"
      >
        No activity yet — click refresh.
      </Flex>
    );
  }

  if (summary.error) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        gap="1"
        className="h-full px-4 py-3 text-center"
      >
        <WarningCircle size={20} weight="duotone" className="text-(--red-10)" />
        <Text className="text-(--gray-12) text-[12px]">{summary.error}</Text>
      </Flex>
    );
  }

  const countTypes = enabled.filter(
    (t): t is Exclude<GithubActivityType, "release"> => t !== "release",
  );
  const showRelease = enabled.includes("release");
  const cellCount = countTypes.length + (showRelease ? 1 : 0);
  const gridColsClass = GRID_COLS[cellCount] ?? "grid-cols-4";

  return (
    <Flex direction="column" className="h-full min-h-0">
      {cellCount > 0 && (
        <Box
          className={`grid shrink-0 ${gridColsClass} gap-2 border-(--gray-4) border-b px-4 py-2.5`}
        >
          {countTypes.map((t) => {
            const Icon = TYPE_ICON[t];
            const count = summary.counts[t] ?? 0;
            return (
              <Flex
                key={t}
                align="center"
                justify="between"
                gap="2"
                className="min-w-0 rounded-(--radius-2) bg-(--gray-2) px-2 py-1.5"
              >
                <Flex
                  align="center"
                  gap="1"
                  className="min-w-0 text-(--gray-11)"
                >
                  <Icon size={11} weight="duotone" />
                  <Text className="truncate text-[10px] uppercase tracking-wide">
                    {TYPE_SHORT[t]}
                  </Text>
                </Flex>
                <Text
                  weight="medium"
                  className="shrink-0 text-(--gray-12) text-[15px] tabular-nums leading-none"
                >
                  {count}
                </Text>
              </Flex>
            );
          })}
          {showRelease && <LatestReleaseCard release={summary.latestRelease} />}
        </Box>
      )}

      <Box className="scrollbar-overlay-y min-h-0 flex-1 overflow-y-auto">
        {summary.recent.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            className="h-full px-4 py-6 text-(--gray-10) text-[12px]"
          >
            No matching activity in the last {summary.windowDays} day
            {summary.windowDays === 1 ? "" : "s"}.
          </Flex>
        ) : (
          <Flex direction="column">
            {summary.recent.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </Flex>
        )}
      </Box>
    </Flex>
  );
}

function LatestReleaseCard({
  release,
}: {
  release: GithubActivitySummary["latestRelease"];
}) {
  const Icon = TYPE_ICON.release;
  if (!release) {
    return (
      <Flex
        align="center"
        justify="between"
        gap="2"
        className="min-w-0 rounded-(--radius-2) bg-(--gray-2) px-2 py-1.5"
      >
        <Flex align="center" gap="1" className="min-w-0 text-(--gray-11)">
          <Icon size={11} weight="duotone" />
          <Text className="truncate text-[10px] uppercase tracking-wide">
            Latest
          </Text>
        </Flex>
        <Text className="shrink-0 text-(--gray-10) text-[11px]">None</Text>
      </Flex>
    );
  }
  // Prefer the tag (typical semver) over the human-friendly release name —
  // the cell's value slot should read like "v1.2.3", matching the count
  // slot's tabular-nums treatment in sibling cards.
  const version = release.tagName || release.name || "Release";
  return (
    <button
      type="button"
      onClick={() => {
        void openUrlInBrowser(release.url);
      }}
      title={`${version}${release.name && release.name !== release.tagName ? ` — ${release.name}` : ""} · ${new Date(release.publishedAt).toLocaleString()}`}
      className="flex min-w-0 items-center justify-between gap-2 rounded-(--radius-2) bg-(--gray-2) px-2 py-1.5 transition-colors hover:bg-(--gray-3)"
    >
      <Flex align="center" gap="1" className="min-w-0 text-(--gray-11)">
        <Icon size={11} weight="duotone" />
        <Text className="truncate text-[10px] uppercase tracking-wide">
          Latest
        </Text>
      </Flex>
      <Text
        weight="medium"
        title={version}
        className="shrink truncate text-(--gray-12) text-[15px] tabular-nums leading-none"
      >
        {version}
      </Text>
    </button>
  );
}

function ActivityRow({ item }: { item: GithubActivityItem }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <button
      type="button"
      onClick={() => {
        void openUrlInBrowser(item.url);
      }}
      className="flex w-full items-start gap-2 border-(--gray-3) border-b px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-(--gray-2)"
    >
      <Box className="mt-0.5 shrink-0 text-(--gray-11)">
        <Icon size={12} weight="duotone" />
      </Box>
      <Box className="min-w-0 flex-1">
        <Text
          as="div"
          className="truncate text-(--gray-12) text-[12px] leading-tight"
        >
          {item.title}
        </Text>
        <Text
          as="div"
          className="truncate text-(--gray-10) text-[11px] leading-snug"
        >
          {item.actor ? `${item.actor} · ` : ""}
          {formatRelativeTimeShort(item.when)} ago
        </Text>
      </Box>
    </button>
  );
}
