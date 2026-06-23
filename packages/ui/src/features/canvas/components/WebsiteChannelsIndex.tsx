import { HashIcon, PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";

// /website index: send the user to their first channel, or prompt them to
// create one when none exist yet.
export function WebsiteChannelsIndex() {
  const { channels, isLoading } = useChannels();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) return null;

  if (channels.length > 0) {
    return (
      <Navigate
        to="/website/$channelId"
        params={{ channelId: channels[0].id }}
        replace
      />
    );
  }

  return (
    <>
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HashIcon size={24} />
          </EmptyMedia>
          <EmptyTitle>Create your first channel</EmptyTitle>
          <EmptyDescription>
            Channels keep related work together — each one has its own canvases,
            tasks, and shared context, like a folder for a product area or team.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            <PlusIcon size={14} />
            Create channel
          </Button>
        </EmptyContent>
      </Empty>
      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
