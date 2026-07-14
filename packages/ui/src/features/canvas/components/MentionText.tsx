import { splitMentionSegments } from "@posthog/shared";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import {
  splitLinkSegments,
  splitRichLinkSegments,
} from "@posthog/ui/features/canvas/utils/linkify";
import {
  getCachedTask,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import "./mention-chip.css";
import {
  ExternalLink,
  File,
  Inbox,
  type LucideIcon,
  Shapes,
  SquircleDashed,
} from "lucide-react";

// The task-list status icon for a `…/tasks/<id>` link — live, like the sidebar
// and feed cards (generating spinner, PR/cloud state). Falls back to the code
// glyph while the task loads or if it isn't cached.
export function TaskLinkIcon({ taskId }: { taskId: string }) {
  const { data } = useQuery({ ...taskDetailQuery(taskId), staleTime: 30_000 });
  return <TaskTabIcon task={data ?? getCachedTask(taskId)} size={12} />;
}

type RenderSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; name: string; email: string };

// Pick the icon + label for an in-app link by its route: a canvas
// (`…/dashboards/…`) gets the Shapes mark, a CONTEXT.md (`…/context`) the File
// mark, a context/channel (`/website/<id>`) the SquircleDashed mark (its "#name"
// label drops the hash, since the icon already says "context"). Anything else
// falls back to the generic link mark.
function internalLinkMeta(
  href: string,
  text: string,
): { Icon: LucideIcon; label: string } {
  if (href.includes("/dashboards/")) return { Icon: Shapes, label: text };
  if (href.endsWith("/context")) return { Icon: File, label: text };
  if (href.includes("/inbox/")) return { Icon: Inbox, label: text };
  if (href.startsWith("/website/")) {
    return { Icon: SquircleDashed, label: text.replace(/^#/, "") };
  }
  return { Icon: ExternalLink, label: text };
}

// The mention chip class (see mention-chip.css). Also used by surfaces that
// render a mention-styled name without real mention semantics (e.g. the channel
// feed's "started a new task" row). Add `mention-chip--self` for the viewer.
export const mentionChipClass = "mention-chip";

/**
 * Thread message content with inline mention tokens rendered as highlighted
 * `@Name` chips (a mention of the viewer gets the stronger treatment) and
 * bare URLs rendered as links.
 */
export function MentionText({
  content,
  currentUserEmail,
  className,
  markdownLinks = false,
}: {
  content: string;
  currentUserEmail?: string | null;
  className?: string;
  /** Also render markdown `[label](url)` links, not just bare URLs. */
  markdownLinks?: boolean;
}) {
  // Key each segment by its character offset — stable for a given content.
  const segments = useMemo(() => {
    const splitLinks = markdownLinks
      ? splitRichLinkSegments
      : splitLinkSegments;
    let offset = 0;
    const entries: Array<{ segment: RenderSegment; key: string }> = [];
    const push = (segment: RenderSegment, length: number) => {
      entries.push({ segment, key: `${offset}` });
      offset += length;
    };
    for (const segment of splitMentionSegments(content)) {
      if (segment.type === "mention") {
        push(
          { type: "mention", name: segment.name, email: segment.email },
          segment.text.length,
        );
      } else {
        for (const part of splitLinks(segment.text)) {
          push(part, part.text.length);
        }
      }
    }
    return entries;
  }, [content, markdownLinks]);
  const selfEmail = currentUserEmail?.toLowerCase();
  const router = useRouter();
  const linkClass = "bg-info/50 px-0.5 rounded-xs hover:bg-info/80";
  return (
    <Text size="1" className={className}>
      {segments.map(({ segment, key }) => {
        if (segment.type === "mention") {
          return (
            <span
              key={key}
              className={
                selfEmail && segment.email.toLowerCase() === selfEmail
                  ? "mention-chip mention-chip--self"
                  : mentionChipClass
              }
              title={segment.email}
            >
              @{segment.name}
            </span>
          );
        }
        if (segment.type === "link") {
          // An in-app route (`/…`) navigates through the router (opening a
          // canvas, context, …) instead of the OS browser.
          if (segment.href.startsWith("/")) {
            const taskId = segment.href.match(/\/tasks\/([^/?#]+)/)?.[1];
            const { Icon, label } = internalLinkMeta(
              segment.href,
              segment.text,
            );
            return (
              <a
                key={key}
                href={segment.href}
                onClick={(event) => {
                  event.preventDefault();
                  void router.history.push(segment.href);
                }}
                className={linkClass}
              >
                <span className="mr-0.5 inline-block align-[-1px]">
                  {taskId ? (
                    <TaskLinkIcon taskId={taskId} />
                  ) : (
                    <Icon size={12} />
                  )}
                </span>
                {taskId ? segment.text : label}
              </a>
            );
          }
          return (
            <a
              key={key}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {segment.text}
            </a>
          );
        }
        return <Fragment key={key}>{segment.text}</Fragment>;
      })}
    </Text>
  );
}
