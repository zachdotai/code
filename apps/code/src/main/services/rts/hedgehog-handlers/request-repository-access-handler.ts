import { requestRepositoryAccessArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const requestRepositoryAccessHandler: HedgehogToolHandler = {
  name: "request_repository_access",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = requestRepositoryAccessArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "request_repository_access",
        parsed.error.message,
      );
    }
    const { repository, reason } = parsed.data;

    try {
      const integrationId =
        await deps.cloudTasks.resolveGithubUserIntegration(repository);

      if (integrationId) {
        deps.writeNestMessage(ctx.nest.id, {
          kind: "audit",
          body: `Granted repository access: ${repository} — ${reason}`,
          payloadJson: {
            type: "repository_access_granted",
            repository,
            reason,
            integrationId,
          },
        });
        return {
          success: true,
          scratchpadSummary: `Granted access to ${repository}`,
        };
      }

      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Denied repository access: ${repository} — operator's GitHub integration does not cover this repo. Reason: ${reason}`,
        payloadJson: {
          type: "repository_access_denied",
          repository,
          reason,
        },
      });
      return {
        success: false,
        scratchpadSummary: `request_repository_access denied: ${repository} not accessible via operator's GitHub`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to validate repository access for ${repository}: ${stringifyError(error)}`,
        payloadJson: {
          type: "repository_access_error",
          repository,
          reason,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `request_repository_access errored: ${stringifyError(error)}`,
      };
    }
  },
};
