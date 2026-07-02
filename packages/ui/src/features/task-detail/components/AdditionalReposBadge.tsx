import { GithubLogo } from "@phosphor-icons/react";
import type { Task } from "@posthog/shared/domain-types";
import { Tooltip } from "../../../primitives/Tooltip";

export function AdditionalReposBadge({ task }: { task: Task }) {
  const extras = task.additional_repositories ?? [];
  if (extras.length === 0) return null;

  return (
    <Tooltip
      side="bottom"
      content={
        <div className="flex flex-col gap-1">
          <span className="text-(--gray-11)">Repositories in this task</span>
          {task.repository && (
            <span className="font-mono">{task.repository}</span>
          )}
          {extras.map((repo) => (
            <span key={repo} className="font-mono">
              {repo}
            </span>
          ))}
        </div>
      }
    >
      <span className="no-drag flex h-[24px] shrink-0 items-center gap-1 rounded-md border border-(--gray-6) px-2 font-mono text-(--gray-11) text-[11px]">
        <GithubLogo size={12} className="shrink-0" />+{extras.length}
      </span>
    </Tooltip>
  );
}
