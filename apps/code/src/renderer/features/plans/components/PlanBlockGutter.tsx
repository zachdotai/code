import { Plus } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
import { usePlanComposeStore } from "../stores/planComposeStore";

interface PlanBlockGutterProps {
  blockText: string | undefined;
  filePath: string;
  taskId: string;
  children: ReactNode;
}

/**
 * Wraps a markdown block (heading, paragraph, list, code) with a hover-
 * revealed `+` button in the left gutter. Clicking opens the compose
 * popover anchored to this block, scoped to `filePath` / `taskId`.
 */
export function PlanBlockGutter({
  blockText,
  filePath,
  taskId,
  children,
}: PlanBlockGutterProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const openAt = usePlanComposeStore((s) => s.openAt);

  const handleClick = useCallback(() => {
    if (!ref.current || !blockText) return;
    const rect = ref.current.getBoundingClientRect();
    openAt({
      anchorRect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
      blockText,
      filePath,
      taskId,
    });
  }, [blockText, filePath, taskId, openAt]);

  return (
    <div ref={ref} className="group relative">
      {blockText && (
        <Tooltip content="Add a comment" side="left">
          <button
            type="button"
            aria-label="Add a comment"
            onClick={handleClick}
            className="-left-7 absolute top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-(--gray-5) bg-(--color-background) text-(--gray-11) opacity-0 transition-opacity hover:bg-(--gray-3) hover:text-(--gray-12) group-hover:opacity-100"
          >
            <Plus size={12} />
          </button>
        </Tooltip>
      )}
      {children}
    </div>
  );
}
