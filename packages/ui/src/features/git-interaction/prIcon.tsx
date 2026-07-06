import {
  Check,
  GitMerge,
  GitPullRequest,
  type Icon,
  PencilSimple,
  Queue,
  X,
} from "@phosphor-icons/react";
import type { PrVisualIcon } from "@posthog/core/git-interaction/prStatus";
import type { PrActionType } from "@posthog/shared";

export function getPrVisualIcon(icon: PrVisualIcon): Icon {
  switch (icon) {
    case "merged":
      return GitMerge;
    case "pull-request":
      return GitPullRequest;
    case "queue":
      return Queue;
  }
}

export function getPrActionIcon(action: PrActionType): React.ReactNode {
  switch (action) {
    case "close":
      return <X size={12} weight="bold" />;
    case "reopen":
      return <GitPullRequest size={12} weight="bold" />;
    case "ready":
      return <Check size={12} weight="bold" />;
    case "draft":
      return <PencilSimple size={12} weight="bold" />;
    case "merge-queue":
      return <GitMerge size={12} weight="bold" />;
    case "merge-queue-cancel":
      return <X size={12} weight="bold" />;
  }
}
