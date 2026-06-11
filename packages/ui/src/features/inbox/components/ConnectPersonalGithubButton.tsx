import { GithubLogoIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";

/**
 * Prompt shown beside the inbox detail actions when the user has no personal
 * GitHub integration. Cloud agent sessions (Discuss / Create PR) author commits
 * as the user, so without one those actions are disabled — this links to the
 * GitHub settings where the account can be connected. Renders nothing once a
 * personal integration exists (or while integrations are still loading).
 */
export function ConnectPersonalGithubButton() {
  const { hasGithubIntegration, isLoadingRepos } =
    useUserRepositoryIntegration();

  if (isLoadingRepos || hasGithubIntegration) return null;

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="gap-1.5"
      onClick={() => openSettings("github")}
    >
      <GithubLogoIcon size={12} />
      Connect personal GitHub for agent sessions
    </Button>
  );
}
