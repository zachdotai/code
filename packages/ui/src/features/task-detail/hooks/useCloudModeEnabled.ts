import { useHostCapabilities } from "@posthog/ui/shell/useHostCapabilities";
import { useFeatureFlag } from "../../feature-flags/useFeatureFlag";

export function useCloudModeEnabled(): boolean {
  // Cloud-only hosts (e.g. the web host) have no local workspace, so cloud mode
  // is always on there regardless of the feature flag.
  const { localWorkspaces } = useHostCapabilities();
  return (
    useFeatureFlag("twig-cloud-mode-toggle") ||
    import.meta.env.DEV ||
    !localWorkspaces
  );
}
