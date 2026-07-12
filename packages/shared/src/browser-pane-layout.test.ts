import { describe, expect, it } from "vitest";
import {
  collectLeafPaneIds,
  insertNodeInLayout,
  insertPaneInLayout,
  normalizeLayout,
  pathToPane,
  removePaneFromLayout,
  setSplitSizesAtPath,
} from "./browser-pane-layout";
import type { PaneLayoutNode } from "./browser-tabs-schemas";

const leaf = (paneId: string): PaneLayoutNode => ({ type: "leaf", paneId });

function split(
  direction: "row" | "column",
  children: PaneLayoutNode[],
  sizes?: number[],
): PaneLayoutNode {
  return {
    type: "split",
    direction,
    children,
    sizes: sizes ?? children.map(() => 1 / children.length),
  };
}

/** Narrow to a split so sizes/children can be asserted. */
function asSplit(node: PaneLayoutNode | null) {
  if (!node || node.type !== "split") {
    throw new Error(`expected a split, got ${node?.type ?? "null"}`);
  }
  return node;
}

function expectSizes(node: PaneLayoutNode | null, expected: number[]): void {
  const s = asSplit(node);
  expect(s.sizes).toHaveLength(expected.length);
  s.sizes.forEach((size, i) => {
    expect(size).toBeCloseTo(expected[i], 10);
  });
}

describe("collectLeafPaneIds", () => {
  it("returns leaves in depth-first display order", () => {
    const tree = split("row", [
      leaf("p1"),
      split("column", [leaf("p2"), leaf("p3")]),
      leaf("p4"),
    ]);
    expect(collectLeafPaneIds(tree)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("insertPaneInLayout", () => {
  it.each([
    ["right", "row", ["p1", "new"]],
    ["left", "row", ["new", "p1"]],
    ["bottom", "column", ["p1", "new"]],
    ["top", "column", ["new", "p1"]],
  ] as const)(
    "wraps a leaf in a two-child split on a %s drop",
    (direction, axis, order) => {
      const result = insertPaneInLayout(leaf("p1"), "p1", direction, "new");
      expect(result).toEqual(
        split(
          axis,
          order.map((id) => leaf(id)),
          [0.5, 0.5],
        ),
      );
    },
  );

  it("splices into a same-axis parent as an n-ary sibling with an equal share", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const result = insertPaneInLayout(root, "p1", "right", "new");
    expect(collectLeafPaneIds(result)).toEqual(["p1", "new", "p2"]);
    expect(asSplit(result).children.every((c) => c.type === "leaf")).toBe(true);
    expectSizes(result, [1 / 3, 1 / 3, 1 / 3]);
  });

  it("scales existing siblings down proportionally when splicing", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.6, 0.4]);
    const result = insertPaneInLayout(root, "p2", "right", "new");
    expect(collectLeafPaneIds(result)).toEqual(["p1", "p2", "new"]);
    expectSizes(result, [0.4, 0.4 * (2 / 3), 1 / 3]);
  });

  it("wraps the target leaf when the drop axis crosses the parent split", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    const result = insertPaneInLayout(root, "p2", "bottom", "new");
    expect(result).toEqual(
      split("row", [
        leaf("p1"),
        split("column", [leaf("p2"), leaf("new")], [0.5, 0.5]),
      ]),
    );
  });

  it("root drop on the matching axis splices as a last (or first) sibling", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const atEnd = insertPaneInLayout(root, null, "right", "new");
    expect(collectLeafPaneIds(atEnd)).toEqual(["p1", "p2", "new"]);
    expectSizes(atEnd, [1 / 3, 1 / 3, 1 / 3]);
    const atStart = insertPaneInLayout(root, null, "left", "new");
    expect(collectLeafPaneIds(atStart)).toEqual(["new", "p1", "p2"]);
  });

  it("root drop on the crossing axis wraps the whole tree", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    const result = insertPaneInLayout(root, null, "bottom", "new");
    expect(result).toEqual(split("column", [root, leaf("new")], [0.5, 0.5]));
  });

  it("root drop on a leaf root wraps it", () => {
    const result = insertPaneInLayout(leaf("p1"), null, "right", "new");
    expect(result).toEqual(split("row", [leaf("p1"), leaf("new")], [0.5, 0.5]));
  });

  it("returns the tree unchanged for an unknown target", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    expect(insertPaneInLayout(root, "nope", "right", "new")).toBe(root);
  });
});

describe("insertNodeInLayout", () => {
  it("keeps a cross-axis subtree intact when wrapping", () => {
    const subtree = split("column", [leaf("q1"), leaf("q2")]);
    const result = insertNodeInLayout(leaf("p1"), "p1", "right", subtree);
    expect(result).toEqual(split("row", [leaf("p1"), subtree], [0.5, 0.5]));
  });

  it("flattens a same-axis subtree when wrapping", () => {
    const subtree = split("row", [leaf("q1"), leaf("q2")], [0.5, 0.5]);
    const result = insertNodeInLayout(leaf("p1"), "p1", "right", subtree);
    expect(collectLeafPaneIds(result)).toEqual(["p1", "q1", "q2"]);
    expect(asSplit(result).children.every((c) => c.type === "leaf")).toBe(true);
    expectSizes(result, [0.5, 0.25, 0.25]);
  });

  it("splices a same-axis subtree into a same-axis parent, sharing its slot", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const subtree = split("row", [leaf("q1"), leaf("q2")], [0.5, 0.5]);
    const result = insertNodeInLayout(root, "p2", "right", subtree);
    expect(collectLeafPaneIds(result)).toEqual(["p1", "p2", "q1", "q2"]);
    expect(asSplit(result).children.every((c) => c.type === "leaf")).toBe(true);
    expectSizes(result, [1 / 3, 1 / 3, 1 / 6, 1 / 6]);
  });

  it("root drop on the matching axis splices the subtree as a sibling", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const subtree = split("column", [leaf("q1"), leaf("q2")]);
    const result = insertNodeInLayout(root, null, "right", subtree);
    expect(collectLeafPaneIds(result)).toEqual(["p1", "p2", "q1", "q2"]);
    expect(asSplit(result).children[2]).toEqual(subtree);
    expectSizes(result, [1 / 3, 1 / 3, 1 / 3]);
  });

  it("inserts before the target on a left/top drop", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const result = insertNodeInLayout(root, "p1", "left", leaf("q1"));
    expect(collectLeafPaneIds(result)).toEqual(["q1", "p1", "p2"]);
  });

  it("returns the tree unchanged for an unknown target", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    expect(insertNodeInLayout(root, "nope", "right", leaf("q1"))).toBe(root);
  });
});

describe("removePaneFromLayout", () => {
  it("returns null when the removed leaf was the root", () => {
    expect(removePaneFromLayout(leaf("p1"), "p1")).toBeNull();
  });

  it("collapses a split left with one child into that child", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    expect(removePaneFromLayout(root, "p2")).toEqual(leaf("p1"));
  });

  it("merges the removed pane's size into the survivors proportionally", () => {
    const root = split(
      "row",
      [leaf("p1"), leaf("p2"), leaf("p3")],
      [0.5, 0.3, 0.2],
    );
    const result = removePaneFromLayout(root, "p2");
    expect(collectLeafPaneIds(asSplit(result))).toEqual(["p1", "p3"]);
    expectSizes(result, [0.5 / 0.7, 0.2 / 0.7]);
  });

  it("collapses a deep nested split and keeps the parent intact", () => {
    const root = split("row", [
      leaf("p1"),
      split("column", [leaf("p2"), leaf("p3")]),
    ]);
    const result = removePaneFromLayout(root, "p3");
    expect(result).toEqual(split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]));
  });

  it("flattens a same-direction split exposed by the removal", () => {
    // Removing p2 collapses the row into column[p3,p4], which nests
    // same-direction under the root column → hoisted into it.
    const root = split("column", [
      leaf("p1"),
      split("row", [leaf("p2"), split("column", [leaf("p3"), leaf("p4")])]),
    ]);
    const result = removePaneFromLayout(root, "p2");
    expect(collectLeafPaneIds(asSplit(result))).toEqual(["p1", "p3", "p4"]);
    expect(asSplit(result).children.every((c) => c.type === "leaf")).toBe(true);
    expect(asSplit(result).direction).toBe("column");
    expectSizes(result, [0.5, 0.25, 0.25]);
  });

  it("returns the tree unchanged for an unknown pane", () => {
    const root = split("row", [leaf("p1"), leaf("p2")]);
    expect(removePaneFromLayout(root, "nope")).toBe(root);
  });
});

describe("setSplitSizesAtPath", () => {
  it("sets (and renormalises) the sizes of the split at the path", () => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    const result = setSplitSizesAtPath(root, [], [3, 1]);
    expectSizes(result, [0.75, 0.25]);
  });

  it("resizes a nested split without touching the parent", () => {
    const root = split("row", [
      leaf("p1"),
      split("column", [leaf("p2"), leaf("p3")], [0.5, 0.5]),
    ]);
    const result = setSplitSizesAtPath(root, [1], [1, 3]);
    expectSizes(result, [0.5, 0.5]);
    expectSizes(asSplit(result).children[1], [0.25, 0.75]);
  });

  it.each([
    ["wrong-length sizes", [] as number[], [1, 1, 1]],
    ["non-positive sizes", [] as number[], [1, 0]],
    ["negative sizes", [] as number[], [2, -1]],
    ["an out-of-range path", [5], [1, 1]],
    ["a path through a leaf", [0, 0], [1, 1]],
  ])("is a no-op for %s", (_name, path, sizes) => {
    const root = split("row", [leaf("p1"), leaf("p2")], [0.5, 0.5]);
    expect(setSplitSizesAtPath(root, path, sizes)).toBe(root);
  });

  it("is a no-op when the root path resolves to a leaf", () => {
    const root = leaf("p1");
    expect(setSplitSizesAtPath(root, [], [1])).toBe(root);
  });
});

describe("pathToPane", () => {
  const tree = split("row", [
    leaf("p1"),
    split("column", [leaf("p2"), leaf("p3")]),
  ]);

  it.each([
    ["p1", [0]],
    ["p2", [1, 0]],
    ["p3", [1, 1]],
  ] as const)("finds %s at %j", (paneId, path) => {
    expect(pathToPane(tree, paneId)).toEqual(path);
  });

  it("returns [] for the root leaf itself", () => {
    expect(pathToPane(leaf("p1"), "p1")).toEqual([]);
  });

  it("returns null for a pane not in the tree", () => {
    expect(pathToPane(tree, "nope")).toBeNull();
  });
});

describe("normalizeLayout", () => {
  it("flattens same-direction nesting, scaling grandchild shares", () => {
    const tree = split(
      "row",
      [leaf("p1"), split("row", [leaf("p2"), leaf("p3")], [0.5, 0.5])],
      [0.5, 0.5],
    );
    const result = normalizeLayout(tree);
    expect(collectLeafPaneIds(asSplit(result))).toEqual(["p1", "p2", "p3"]);
    expect(asSplit(result).children.every((c) => c.type === "leaf")).toBe(true);
    expectSizes(result, [0.5, 0.25, 0.25]);
  });

  it("renormalises sizes that do not sum to 1", () => {
    const result = normalizeLayout(
      split("row", [leaf("p1"), leaf("p2")], [2, 2]),
    );
    expectSizes(result, [0.5, 0.5]);
  });

  it("replaces invalid sizes (wrong length / non-positive) with equal shares", () => {
    const wrongLength = normalizeLayout(
      split("row", [leaf("p1"), leaf("p2")], [1]),
    );
    expectSizes(wrongLength, [0.5, 0.5]);
    const nonPositive = normalizeLayout(
      split("row", [leaf("p1"), leaf("p2")], [0, 1]),
    );
    expectSizes(nonPositive, [0.5, 0.5]);
  });

  it("collapses a single-child split into its child", () => {
    expect(normalizeLayout(split("row", [leaf("p1")], [1]))).toEqual(
      leaf("p1"),
    );
  });

  it("returns null for an empty split", () => {
    expect(normalizeLayout(split("row", [], []))).toBeNull();
  });

  it("passes a leaf through with the same reference", () => {
    const node = leaf("p1");
    expect(normalizeLayout(node)).toBe(node);
  });

  it("keeps a canonical tree's shape", () => {
    const tree = split(
      "row",
      [leaf("p1"), split("column", [leaf("p2"), leaf("p3")], [0.5, 0.5])],
      [0.5, 0.5],
    );
    expect(normalizeLayout(tree)).toEqual(tree);
  });

  it("passes a canonical SPLIT through with the same reference", () => {
    // Healing decides whether to re-persist by reference equality, so an
    // already-canonical split must come back identical — otherwise every load
    // of a split layout rewrites the database.
    const tree = split(
      "row",
      [leaf("p1"), split("column", [leaf("p2"), leaf("p3")], [0.5, 0.5])],
      [0.3, 0.7],
    );
    expect(normalizeLayout(tree)).toBe(tree);
  });
});
