import { HashIcon, ShapesIcon, XIcon } from "@phosphor-icons/react";
import { Button, Text } from "@posthog/quill";
import { useChannelsOnboardingStore } from "@posthog/ui/features/canvas/stores/channelsOnboardingStore";

// A one-time, dismissible callout shown atop a channel's landing view that
// orients newcomers: what a channel is, and what a canvas is. Returns null once
// dismissed (persisted), so it never nags.
export function ChannelsWelcome() {
  const dismissed = useChannelsOnboardingStore((s) => s.welcomeDismissed);
  const dismiss = useChannelsOnboardingStore((s) => s.dismissWelcome);

  if (dismissed) return null;

  return (
    <div className="relative mx-5 mt-5 rounded-lg border border-border bg-gray-2 p-4">
      <Button
        variant="link-muted"
        size="icon-xs"
        aria-label="Dismiss welcome"
        className="absolute top-2 right-2 text-gray-9"
        onClick={dismiss}
      >
        <XIcon size={14} />
      </Button>

      <Text weight="semibold" className="text-gray-12">
        Welcome to channels
      </Text>
      <div className="mt-3 flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          <HashIcon size={16} className="mt-0.5 shrink-0 text-gray-9" />
          <Text size="sm" variant="muted">
            A <span className="font-medium text-gray-12">channel</span> groups
            related work — its own canvases, tasks, and shared context.
          </Text>
        </div>
        <div className="flex items-start gap-2.5">
          <ShapesIcon size={16} className="mt-0.5 shrink-0 text-gray-9" />
          <Text size="sm" variant="muted">
            A <span className="font-medium text-gray-12">canvas</span> is a live
            mini-app built from your PostHog data — just describe what you want
            and an agent builds it.
          </Text>
        </div>
      </div>
    </div>
  );
}
