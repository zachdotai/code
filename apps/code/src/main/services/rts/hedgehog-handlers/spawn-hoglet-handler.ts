import { logger } from "../../../utils/logger";
import {
  MAX_SPAWN_HOGLET_PROMPT_CHARS,
  spawnHogletArgs,
} from "../hedgehog-tools";
import { findSimilarRepoSlugs } from "../repo-slug-match";
import {
  clampReasoningEffortForAdapter,
  defaultModelForAdapter,
  defaultReasoningEffortForAdapter,
} from "../schemas";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError, truncate } from "./utils";

const log = logger.scope("spawn-hoglet-handler");

export const MAX_SPAWN_CALLS_PER_TICK = 3;

export const spawnHogletHandler: HedgehogToolHandler = {
  name: "spawn_hoglet",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    if (ctx.budget.spawnCount >= MAX_SPAWN_CALLS_PER_TICK) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Hedgehog tried to spawn another hoglet but per-tick cap (${MAX_SPAWN_CALLS_PER_TICK}) was reached.`,
        payloadJson: { type: "spawn_capped", attempted: block.input },
      });
      return { success: false, scratchpadSummary: "spawn_hoglet capped" };
    }
    ctx.budget.spawnCount += 1;

    const parsed = spawnHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "spawn_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const prompt =
      args.prompt.length > MAX_SPAWN_HOGLET_PROMPT_CHARS
        ? args.prompt.slice(0, MAX_SPAWN_HOGLET_PROMPT_CHARS)
        : args.prompt;
    if (args.signal_report_id) {
      const suppressed = ctx.operatorDecisions.find(
        (d) =>
          d.kind === "suppress_signal_report" &&
          d.subjectKey === args.signal_report_id,
      );
      if (suppressed) {
        deps.writeNestMessage(ctx.nest.id, {
          kind: "audit",
          body: `Skipped spawn_hoglet: operator suppressed signal report ${args.signal_report_id}.`,
          payloadJson: {
            type: "spawn_suppressed_by_operator",
            signalReportId: args.signal_report_id,
            reason: suppressed.reason,
            decisionId: suppressed.id,
          },
        });
        return {
          success: false,
          scratchpadSummary: `Operator suppressed signal report ${args.signal_report_id}; skipping spawn.`,
        };
      }
    }
    const available = ctx.repositoryContext.availableRepositories;
    // GitHub slugs are case-insensitive on github.com; the integration API
    // returns lowercase while operator transcripts often capitalize the org.
    // Compare on lowercase to keep `Brooker-Fam/foo` and `brooker-fam/foo`
    // from being treated as different repos.
    const availableLowerSet = new Set(available.map((s) => s.toLowerCase()));
    const hasAvailable = (slug: string): boolean =>
      availableLowerSet.has(slug.toLowerCase());
    if (args.repository && !hasAvailable(args.repository)) {
      const detail =
        available.length === 0
          ? "no repositories are configured locally"
          : `must be one of: ${available.join(", ")}`;
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "spawn_hoglet",
        `repository '${args.repository}' is not in available_repositories (${detail})`,
      );
    }
    const persistedPrimary =
      ctx.nest.primaryRepository && hasAvailable(ctx.nest.primaryRepository)
        ? ctx.nest.primaryRepository
        : null;
    if (ctx.nest.primaryRepository && persistedPrimary === null) {
      log.warn(
        "nest.primaryRepository missing from available_repositories; falling through",
        {
          nestId: ctx.nest.id,
          primaryRepository: ctx.nest.primaryRepository,
          available,
        },
      );
    }
    const soleAvailable =
      available.length === 1 ? (available[0] ?? null) : null;
    const repository =
      args.repository ?? persistedPrimary ?? soleAvailable ?? null;
    const repositorySource: "tool_call" | "nest_primary" | "sole_available" =
      args.repository
        ? "tool_call"
        : persistedPrimary
          ? "nest_primary"
          : "sole_available";

    if (!repository) {
      const detail =
        available.length === 0
          ? "no repositories are configured locally"
          : `pick one of: ${available.join(", ")}`;
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Refused spawn_hoglet — no repository could be resolved (${detail}). Hedgehog must pass a repository slug on the tool call.`,
        payloadJson: {
          type: "spawn_missing_repository",
          attempted: args,
          availableRepositories: available,
        },
      });
      return {
        success: false,
        scratchpadSummary:
          "spawn_hoglet refused: no repository resolvable for this nest",
      };
    }

    try {
      const integration =
        await deps.cloudTasks.resolveGithubUserIntegration(repository);
      if (!integration) {
        const accessibleRepositories =
          await deps.cloudTasks.listAccessibleRepositorySlugs();
        const suggestions = findSimilarRepoSlugs(
          repository,
          accessibleRepositories,
        );
        const suggestionText =
          suggestions.length > 0
            ? ` Did you mean: ${suggestions.join(", ")}?`
            : "";
        deps.writeNestMessage(ctx.nest.id, {
          kind: "audit",
          body: `Repository "${repository}" is not accessible.${suggestionText}`,
          payloadJson: {
            type: "spawn_repository_not_accessible",
            repository,
            suggestions,
          },
        });
        return {
          success: false,
          scratchpadSummary: `spawn_hoglet refused: repository "${repository}" is not accessible${
            suggestions.length > 0
              ? `; suggestions: ${suggestions.join(", ")}`
              : ""
          }`,
        };
      }
    } catch (error) {
      log.warn("Repository validation failed before spawn; proceeding", {
        nestId: ctx.nest.id,
        repository,
        error: stringifyError(error),
      });
    }

    try {
      const { hoglet, taskRunId } = await deps.hogletService.spawnInNest(
        {
          nestId: ctx.nest.id,
          prompt,
          repository,
        },
        ctx.loadout,
      );
      const promptWasTruncated = prompt.length !== args.prompt.length;
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        sourceTaskId: hoglet.taskId,
        body: `Spawned hoglet ${hoglet.name ?? hoglet.id}: ${truncate(prompt, 200)}`,
        payloadJson: {
          type: "spawned_hoglet",
          hogletId: hoglet.id,
          hogletName: hoglet.name,
          taskId: hoglet.taskId,
          taskRunId,
          repository,
          repositorySource,
          promptWasTruncated,
          originalPromptLength: promptWasTruncated
            ? args.prompt.length
            : undefined,
          promptLength: prompt.length,
          model:
            ctx.loadout.model ??
            defaultModelForAdapter(ctx.loadout.runtimeAdapter),
          reasoningEffort: clampReasoningEffortForAdapter(
            ctx.loadout.reasoningEffort ??
              defaultReasoningEffortForAdapter(ctx.loadout.runtimeAdapter),
            ctx.loadout.runtimeAdapter,
          ),
        },
      });
      return {
        success: true,
        scratchpadSummary: `Spawned hoglet ${hoglet.name ?? hoglet.id} (task=${hoglet.taskId})`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to spawn hoglet: ${stringifyError(error)}`,
        payloadJson: {
          type: "spawn_failed",
          error: stringifyError(error),
          prompt: truncate(prompt, 200),
        },
      });
      return {
        success: false,
        scratchpadSummary: `spawn_hoglet errored: ${stringifyError(error)}`,
      };
    }
  },
};
