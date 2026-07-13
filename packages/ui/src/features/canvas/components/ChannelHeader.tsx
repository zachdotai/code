import { SparkleIcon } from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
import { ChannelTabs } from "@posthog/ui/features/canvas/components/ChannelTabs";
import { InsertFakeMessageDialog } from "@posthog/ui/features/canvas/components/InsertFakeMessageDialog";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { SquircleDashed } from "lucide-react";
import { useState } from "react";

// The shared channel header: a clickable "# channel" that doubles as the Home
// item — it routes to the channel home (`/website/$channelId`, like the sidebar
// channel row) and highlights `bg-fill-selected` while you're there, the same
// pathname-driven active state the rest of the channel tab strip uses. Followed
// by that strip (Artifacts / Recents / CONTEXT.md), rendered into the
// header bar by every channel view so the tabs stay in view.
export function ChannelHeader({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === `/website/${channelId}`;
  // Dev-only demo tool: post a "fake" message into the channel feed.
  const [fakeMessageOpen, setFakeMessageOpen] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        data-selected={isHome || undefined}
        onClick={() =>
          void navigate({ to: "/website/$channelId", params: { channelId } })
        }
        size="sm"
        className={cn("min-w-0", isHome ? "bg-fill-selected" : "")}
      >
        <SquircleDashed
          size={20}
          className="shrink-0 text-muted-foreground/80"
        />
        <Text className="min-w-0 truncate font-medium" title={channelName}>
          {channelName ?? "Context"}
        </Text>
      </Button>
      <ChannelTabs channelId={channelId} />

      {import.meta.env.DEV && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ms-auto shrink-0"
            onClick={() => setFakeMessageOpen(true)}
          >
            <SparkleIcon size={14} />
            Insert fake message
          </Button>
          <InsertFakeMessageDialog
            channelId={channelId}
            open={fakeMessageOpen}
            onOpenChange={setFakeMessageOpen}
          />
        </>
      )}
    </div>
  );
}
