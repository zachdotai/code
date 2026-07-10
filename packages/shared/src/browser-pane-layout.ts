import type {
  PaneLayoutNode,
  SplitDropDirection,
} from "./browser-tabs-schemas";

/**
 * Pure geometry math for the pane layout tree ({@link PaneLayoutNode}).
 * Snapshot-level pane transforms (which also move tabs and focus) live in
 * `browser-tabs.ts`; this module never sees tabs or panes rows, only the tree.
 *
 * Canonical form (maintained by every function here, enforceable via
 * {@link normalizeLayout}): splits hold >= 2 children, `sizes` is parallel to
 * `children`, positive, summing to 1, and a split never directly contains a
 * child split with the same direction (same-direction children are flattened
 * into the parent, VS Code style).
 */

const EQUAL = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

function renormalize(sizes: number[], count: number): number[] {
  if (sizes.length !== count || sizes.some((s) => !(s > 0))) {
    return EQUAL(count);
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return EQUAL(count);
  // Already normalized → keep the input's identity, so canonical trees pass
  // through normalizeLayout unchanged (healing relies on reference equality
  // to decide whether to re-persist).
  if (Math.abs(total - 1) < 1e-9) return sizes;
  return sizes.map((s) => s / total);
}

function directionOf(drop: SplitDropDirection): "row" | "column" {
  return drop === "left" || drop === "right" ? "row" : "column";
}

/** Leaf pane ids in depth-first (display) order. */
export function collectLeafPaneIds(node: PaneLayoutNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return node.children.flatMap(collectLeafPaneIds);
}

/**
 * Insert a new pane next to `targetPaneId` on the `direction` side —
 * `targetPaneId: null` targets the window root (content-area edge drops).
 * If the insertion axis matches the surrounding split, the new leaf is spliced
 * in as a sibling (n-ary); otherwise the target is wrapped in a new
 * two-child split. The new pane takes an equal share of the affected split;
 * existing siblings scale down proportionally. Unknown target → tree returned
 * unchanged.
 */
export function insertPaneInLayout(
  root: PaneLayoutNode,
  targetPaneId: string | null,
  direction: SplitDropDirection,
  newPaneId: string,
): PaneLayoutNode {
  const axis = directionOf(direction);
  const before = direction === "left" || direction === "top";
  const newLeaf: PaneLayoutNode = { type: "leaf", paneId: newPaneId };

  const wrap = (node: PaneLayoutNode): PaneLayoutNode => ({
    type: "split",
    direction: axis,
    children: before ? [newLeaf, node] : [node, newLeaf],
    sizes: [0.5, 0.5],
  });

  if (targetPaneId === null) {
    // Root drop: splice into a same-axis root split, else wrap the whole tree.
    if (root.type === "split" && root.direction === axis) {
      return spliceSibling(root, before ? 0 : root.children.length, newLeaf);
    }
    return wrap(root);
  }

  const insert = (node: PaneLayoutNode): PaneLayoutNode | null => {
    if (node.type === "leaf") {
      return node.paneId === targetPaneId ? wrap(node) : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      // Target leaf directly under a same-axis split → splice as a sibling
      // instead of nesting a redundant same-direction split.
      if (
        child.type === "leaf" &&
        child.paneId === targetPaneId &&
        node.direction === axis
      ) {
        return spliceSibling(node, before ? i : i + 1, newLeaf);
      }
      const replaced = insert(child);
      if (replaced) {
        const children = node.children.map((c, j) => (j === i ? replaced : c));
        return { ...node, children };
      }
    }
    return null;
  };

  return insert(root) ?? root;
}

/** Splice a new child into a split at `index`, giving it an equal share. */
function spliceSibling(
  split: Extract<PaneLayoutNode, { type: "split" }>,
  index: number,
  child: PaneLayoutNode,
): PaneLayoutNode {
  const n = split.children.length;
  const sizes = renormalize(split.sizes, n);
  const share = 1 / (n + 1);
  const scaled = sizes.map((s) => s * (1 - share));
  const children = [...split.children];
  children.splice(index, 0, child);
  scaled.splice(index, 0, share);
  return { ...split, children, sizes: scaled };
}

/**
 * Remove a pane's leaf. Its size merges into the remaining siblings
 * (proportionally); a split left with one child collapses into that child.
 * Returns null when the tree is now empty (the removed leaf was the root).
 * Unknown pane → tree returned unchanged.
 */
export function removePaneFromLayout(
  root: PaneLayoutNode,
  paneId: string,
): PaneLayoutNode | null {
  if (root.type === "leaf") {
    return root.paneId === paneId ? null : root;
  }
  const removed = root.children
    .map((child) => removePaneFromLayout(child, paneId))
    .map((child, i) => ({ child, i }))
    .filter((x): x is { child: PaneLayoutNode; i: number } => x.child !== null);
  if (removed.length === root.children.length) {
    // Nothing removed below, but a child may have been rewritten.
    const children = removed.map((x) => x.child);
    const changed = children.some((c, i) => c !== root.children[i]);
    return changed ? normalizeLayout({ ...root, children }) : root;
  }
  if (removed.length === 0) return null;
  if (removed.length === 1) return removed[0].child;
  const orig = renormalize(root.sizes, root.children.length);
  const sizes = renormalize(
    removed.map((x) => orig[x.i]),
    removed.length,
  );
  return normalizeLayout({
    ...root,
    children: removed.map((x) => x.child),
    sizes,
  });
}

/**
 * Set the sizes of the split addressed by `path` (child indices from the
 * root). Validated: the path must resolve to a split and `sizes` must be
 * positive and parallel to its children, else the tree is returned unchanged.
 * Resize is a local low-contention gesture, so path addressing beats minting
 * split-node ids.
 */
export function setSplitSizesAtPath(
  root: PaneLayoutNode,
  path: number[],
  sizes: number[],
): PaneLayoutNode {
  if (path.length === 0) {
    if (
      root.type !== "split" ||
      sizes.length !== root.children.length ||
      sizes.some((s) => !(s > 0))
    ) {
      return root;
    }
    return { ...root, sizes: renormalize(sizes, sizes.length) };
  }
  const [head, ...rest] = path;
  if (root.type !== "split" || head < 0 || head >= root.children.length) {
    return root;
  }
  const child = setSplitSizesAtPath(root.children[head], rest, sizes);
  if (child === root.children[head]) return root;
  return {
    ...root,
    children: root.children.map((c, i) => (i === head ? child : c)),
  };
}

/** Path (child indices from the root) to the split node containing `paneId`'s
 * leaf, or to any node — used by the renderer to address resizes. Returns null
 * when the pane is not in the tree. */
export function pathToPane(
  root: PaneLayoutNode,
  paneId: string,
): number[] | null {
  if (root.type === "leaf") {
    return root.paneId === paneId ? [] : null;
  }
  for (let i = 0; i < root.children.length; i++) {
    const sub = pathToPane(root.children[i], paneId);
    if (sub !== null) return [i, ...sub];
  }
  return null;
}

/**
 * Canonicalise a tree: drop empty splits, collapse single-child splits,
 * flatten same-direction nesting, renormalise sizes. Null when nothing
 * remains. The healing primitive behind `ensureSnapshotIntegrity`.
 */
export function normalizeLayout(node: PaneLayoutNode): PaneLayoutNode | null {
  if (node.type === "leaf") return node;
  const sizes = renormalize(node.sizes, node.children.length);
  const flattened: { child: PaneLayoutNode; size: number }[] = [];
  let changed = node.sizes !== sizes;
  node.children.forEach((raw, i) => {
    const child = normalizeLayout(raw);
    if (child === null) {
      changed = true;
      return;
    }
    if (child !== raw) changed = true;
    if (child.type === "split" && child.direction === node.direction) {
      // Same-direction nesting: hoist grandchildren, scaling their share.
      changed = true;
      child.children.forEach((grand, j) => {
        flattened.push({ child: grand, size: sizes[i] * child.sizes[j] });
      });
      return;
    }
    flattened.push({ child, size: sizes[i] });
  });
  if (flattened.length === 0) return null;
  if (flattened.length === 1) return flattened[0].child;
  if (!changed) return node;
  return {
    type: "split",
    direction: node.direction,
    children: flattened.map((x) => x.child),
    sizes: renormalize(
      flattened.map((x) => x.size),
      flattened.length,
    ),
  };
}
