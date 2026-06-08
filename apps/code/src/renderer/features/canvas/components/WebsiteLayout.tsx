import { DashboardRefreshControl } from "@features/canvas/components/DashboardRefreshControl";
import { dashboardTitleFromSpec } from "@features/canvas/genui/dashboardTitle";
import { useChannels } from "@features/canvas/hooks/useChannels";
import {
  useDashboard,
  useDashboardMutations,
} from "@features/canvas/hooks/useDashboards";
import {
  useCanvasChatStore,
  useCanvasThread,
} from "@features/canvas/stores/canvasChatStore";
import {
  useDashboardEditStore,
  useIsDashboardEditing,
} from "@features/canvas/stores/dashboardEditStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { isNonEmptySpec } from "@json-render/core";
import {
  CaretRightIcon,
  GitForkIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { Fragment, useMemo } from "react";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// Edit toggle + (in edit mode) Save / Save-as-fork for the active dashboard.
function DashboardControls({
  channelId,
  dashboardId,
}: {
  channelId: string;
  dashboardId: string;
}) {
  const navigate = useNavigate();
  const editing = useIsDashboardEditing(dashboardId);
  const setEditing = useDashboardEditStore((s) => s.setEditing);
  const resetThread = useCanvasChatStore((s) => s.reset);

  const threadId = threadIdFor(dashboardId);
  const { dashboard } = useDashboard(dashboardId);
  const { spec: liveSpec } = useCanvasThread(threadId);
  const { saveDashboard, createDashboard, isSaving } = useDashboardMutations();

  const savedSpec = dashboard?.spec ?? null;
  const hasSpec = isNonEmptySpec(liveSpec);
  const dirty =
    hasSpec && JSON.stringify(liveSpec) !== JSON.stringify(savedSpec);

  const onSave = () => {
    if (!dirty) return;
    // The h1 title is the dashboard's name: sync it to the file on every save so
    // renaming the canvas title renames the saved dashboard.
    void saveDashboard(dashboardId, liveSpec, dashboardTitleFromSpec(liveSpec));
  };

  const onFork = async () => {
    if (!hasSpec) return;
    const title =
      dashboardTitleFromSpec(liveSpec) ?? dashboard?.name ?? "Dashboard";
    const name = `${title} (fork)`;
    const record = await createDashboard(channelId, name, liveSpec);
    setEditing(record.id, true);
    void navigate({
      to: "/website/$channelId/dashboards/$dashboardId",
      params: { channelId, dashboardId: record.id },
    });
  };

  const onToggleEdit = () => {
    if (editing) {
      // Cancel: drop unsaved edits. Resetting the thread clears the live spec so
      // re-entering edit re-seeds from the saved dashboard; the file is untouched.
      void resetThread(threadId);
      setEditing(dashboardId, false);
    } else {
      setEditing(dashboardId, true);
    }
  };

  return (
    <Flex align="center" gap="2" className="no-drag ml-auto">
      {/* Refresh is view-mode only: in edit the canvas shows the live thread
          spec, so a file refresh wouldn't show and Save would clobber it. */}
      {!editing && <DashboardRefreshControl dashboardId={dashboardId} />}
      {editing && (
        <>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || isSaving}
            onClick={onSave}
          >
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSpec}
            onClick={onFork}
          >
            <GitForkIcon size={14} />
            Save as fork
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        data-selected={editing}
        onClick={onToggleEdit}
      >
        {editing ? (
          <XIcon size={14} />
        ) : (
          <PencilSimpleIcon size={14} weight="regular" />
        )}
        {editing ? "Cancel" : "Edit"}
      </Button>
    </Flex>
  );
}

// Breadcrumb topbar + content outlet for the Website space (channel-scoped).
export function WebsiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const { data: tasks } = useTasks();
  const { channels } = useChannels();

  const channelId = params.channelId;
  const dashboardId = params.dashboardId;
  const taskId = params.taskId;
  const base = channelId ? `/website/${channelId}` : "/website";
  const channelName = channelId
    ? (channels.find((c) => c.id === channelId)?.name ?? "channel")
    : null;

  const isDashboardDetail = Boolean(channelId && dashboardId);
  const taskTitle = taskId
    ? tasks?.find((t) => t.id === taskId)?.title
    : undefined;

  // Breadcrumbs + (on a dashboard) its controls live in the global title bar via
  // the header store — there's no second bar, so the channel space reclaims the
  // ~40px the standalone breadcrumb row used to take.
  const headerContent = useMemo(() => {
    if (!channelId) return null;

    // The channel (links to its dashboards grid), then the active sub-view.
    const crumbs: React.ReactNode[] = [
      <ChannelGridLink key="channel" channelId={channelId}>
        {channelName}
      </ChannelGridLink>,
    ];
    if (isDashboardDetail && dashboardId) {
      // On a single dashboard, the grid is the parent: show it as a link. The
      // dashboard's own name is the h1 below, so it isn't repeated as a crumb.
      crumbs.push(
        <ChannelGridLink key="dashboards" channelId={channelId}>
          Dashboards
        </ChannelGridLink>,
      );
    } else if (pathname === `${base}/new`) {
      crumbs.push(<CrumbText key="new">New task</CrumbText>);
    } else if (pathname.startsWith(`${base}/settings`)) {
      crumbs.push(<CrumbText key="settings">Settings</CrumbText>);
    } else if (taskId) {
      crumbs.push(<CrumbText key="task">{taskTitle || "Task"}</CrumbText>);
    }
    // The dashboards grid itself adds no crumb — its h1 is "Dashboards" and the
    // channel crumb already links to it.

    return (
      <Flex
        align="center"
        justify="between"
        gap="2"
        pr="3"
        className="w-full min-w-0"
      >
        <Flex align="center" gap="1" className="min-w-0">
          {crumbs.map((crumb, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: crumb order is stable
            <Fragment key={i}>
              {i > 0 && <CaretRightIcon size={12} className="text-gray-8" />}
              {crumb}
            </Fragment>
          ))}
        </Flex>
        {isDashboardDetail && channelId && dashboardId && (
          <DashboardControls channelId={channelId} dashboardId={dashboardId} />
        )}
      </Flex>
    );
  }, [
    channelId,
    channelName,
    dashboardId,
    isDashboardDetail,
    pathname,
    base,
    taskId,
    taskTitle,
  ]);

  useSetHeaderContent(headerContent);

  return (
    <Box height="100%" overflow="hidden">
      <Outlet />
    </Box>
  );
}

// A breadcrumb link back to the channel's dashboards grid. Renders as a centered
// inline-flex so it shares the dashboard-name crumb's vertical alignment.
function ChannelGridLink({
  channelId,
  children,
}: {
  channelId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/website/$channelId"
      params={{ channelId }}
      className="no-drag inline-flex items-center"
    >
      <Text
        size="1"
        weight="medium"
        className="text-muted-foreground transition-colors hover:text-gray-12"
      >
        {children}
      </Text>
    </Link>
  );
}

function CrumbText({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="1"
      weight="medium"
      className="inline-flex items-center text-gray-12"
    >
      {children}
    </Text>
  );
}
