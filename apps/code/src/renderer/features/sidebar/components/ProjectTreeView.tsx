import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { CaretDownIcon, CaretRightIcon, EyeIcon } from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Flex } from "@radix-ui/themes";
import type { RenderingCanvas } from "@renderer/api/posthogClient";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo, useState } from "react";
import { SidebarItem } from "./SidebarItem";

interface CanvasTreeNode {
  name: string;
  path: string;
  depth: number;
  canvasId?: string;
  children: CanvasTreeNode[];
}

function buildCanvasTree(canvases: RenderingCanvas[]): CanvasTreeNode[] {
  const root: CanvasTreeNode = { name: "", path: "", depth: -1, children: [] };
  const index = new Map<string, CanvasTreeNode>();
  index.set("", root);

  const sorted = [...canvases].sort((a, b) =>
    (a.path ?? "").localeCompare(b.path ?? ""),
  );

  for (const canvas of sorted) {
    const segments = (canvas.path ?? "").split("/").filter(Boolean);

    if (segments.length === 0) {
      root.children.push({
        name: canvas.name,
        path: `__root__${canvas.id}`,
        depth: 0,
        canvasId: canvas.id,
        children: [],
      });
      continue;
    }

    let parentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const currentPath = segments.slice(0, i + 1).join("/");
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        const leaf: CanvasTreeNode = {
          name: canvas.name,
          path: `${currentPath}__${canvas.id}`,
          depth: i,
          canvasId: canvas.id,
          children: [],
        };
        index.get(parentPath)?.children.push(leaf);
      } else {
        let node = index.get(currentPath);
        if (!node) {
          node = { name: segment, path: currentPath, depth: i, children: [] };
          index.get(parentPath)?.children.push(node);
          index.set(currentPath, node);
        }
      }
      parentPath = currentPath;
    }
  }

  return root.children;
}

interface CanvasRowProps {
  node: CanvasTreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (canvasId: string) => void;
}

function CanvasRow({ node, expanded, onToggle, onSelect }: CanvasRowProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.path);

  const icon = hasChildren ? (
    // biome-ignore lint/a11y/useSemanticElements: nested inside SidebarItem button
    <span
      role="button"
      tabIndex={0}
      className="flex h-4 w-4 cursor-pointer items-center justify-center rounded hover:bg-gray-4"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(node.path);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle(node.path);
        }
      }}
    >
      {isOpen ? (
        <CaretDownIcon size={12} weight="bold" />
      ) : (
        <CaretRightIcon size={12} weight="bold" />
      )}
    </span>
  ) : (
    <EyeIcon size={14} />
  );

  return (
    <>
      <SidebarItem
        depth={node.depth}
        icon={icon}
        label={node.name}
        onClick={
          node.canvasId
            ? () => onSelect(node.canvasId!)
            : () => onToggle(node.path)
        }
      />
      {hasChildren && isOpen
        ? node.children.map((child) => (
            <CanvasRow
              key={child.path}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  );
}

export function ProjectTreeView() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const navigateToCanvasInput = useNavigationStore(
    (s) => s.navigateToCanvasInput,
  );

  const { data, isLoading } = useAuthenticatedQuery(
    ["rendering-canvases"] as const,
    (client) => client.listRenderingCanvases(),
  );

  const tree = useMemo(() => buildCanvasTree(data?.results ?? []), [data]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
      <Flex direction="column" py="2" px="2" gap="2">
        {isLoading ? (
          <SidebarItem
            depth={0}
            icon={<DotsCircleSpinner size={12} className="text-gray-10" />}
            label="Loading canvases..."
            disabled
          />
        ) : tree.length === 0 ? (
          <SidebarItem depth={0} label="No canvases" disabled />
        ) : (
          tree.map((node) => (
            <CanvasRow
              key={node.path}
              node={node}
              expanded={expanded}
              onToggle={toggle}
              onSelect={navigateToCanvasInput}
            />
          ))
        )}
      </Flex>
    </ScrollArea>
  );
}
