import { RTS_FLAG } from "@posthog/shared/constants";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { BgmPlayer } from "@posthog/ui/features/rts/audio/BgmPlayer";
import { SfxBridge } from "@posthog/ui/features/rts/audio/SfxBridge";
import { useRtsPrGraphRouter } from "@posthog/ui/features/rts/hooks/useRtsPrGraphRouter";
import { useRtsPromptRouter } from "@posthog/ui/features/rts/hooks/useRtsPromptRouter";

// Wrapping the RTS background services (prompt router, PR-graph router) and
// audio bridges in a single flag-gated boundary keeps non-RTS users from
// creating Audio elements (which trigger a network fetch from the RTS asset
// CDN at mount) or opening tRPC subscriptions they'll never use.
function RtsActive() {
  useRtsPromptRouter();
  useRtsPrGraphRouter();
  return (
    <>
      <BgmPlayer />
      <SfxBridge />
    </>
  );
}

export function RtsRoot() {
  const rtsEnabled = useFeatureFlag(RTS_FLAG, import.meta.env.DEV);
  if (!rtsEnabled) return null;
  return <RtsActive />;
}
