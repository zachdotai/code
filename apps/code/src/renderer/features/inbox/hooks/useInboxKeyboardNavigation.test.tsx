import { useInboxReportSelectionStore } from "@features/inbox/stores/inboxReportSelectionStore";
import type { SignalReport } from "@shared/types";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useInboxKeyboardNavigation } from "./useInboxKeyboardNavigation";

function makeReport(id: string): SignalReport {
  return {
    id,
    title: id,
    summary: null,
    status: "potential",
    total_weight: 0,
    signal_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    artefact_count: 0,
  };
}

const REPORTS: SignalReport[] = ["a", "b", "c", "d", "e"].map(makeReport);

function getSelection() {
  return useInboxReportSelectionStore.getState().selectedReportIds;
}

function getLastClicked() {
  return useInboxReportSelectionStore.getState().lastClickedId;
}

/** Mimic InboxSignalsTab.handleReportClick — plain click. */
function plainClick(id: string) {
  act(() => {
    useInboxReportSelectionStore.getState().setSelectedReportIds([id]);
  });
}

/** Mimic InboxSignalsTab.handleReportClick — cmd-click. */
function cmdClick(id: string) {
  act(() => {
    useInboxReportSelectionStore.getState().toggleReportSelection(id);
  });
}

/** Mimic InboxSignalsTab.handleReportClick — shift-click. */
function shiftClick(id: string, reports: SignalReport[] = REPORTS) {
  act(() => {
    useInboxReportSelectionStore.getState().selectRange(
      id,
      reports.map((r) => r.id),
    );
  });
}

describe("useInboxKeyboardNavigation", () => {
  beforeEach(() => {
    useInboxReportSelectionStore.setState({
      selectedReportIds: [],
      lastClickedId: null,
    });
  });

  describe("arrow navigation from an empty selection", () => {
    it.each<[1 | -1, string]>([
      [1, "ArrowDown"],
      [-1, "ArrowUp"],
    ])("%s selects the first report when nothing is selected", (direction) => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      act(() => {
        result.current.navigateReport(direction, false);
      });

      expect(getSelection()).toEqual(["a"]);
    });

    it("returns null when the list is empty", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: [] }),
      );

      let nextId: string | null = "unset";
      act(() => {
        nextId = result.current.navigateReport(1, false);
      });

      expect(nextId).toBeNull();
      expect(getSelection()).toEqual([]);
    });
  });

  describe("arrow navigation after a click (regression for cursor drift)", () => {
    it("ArrowDown after clicking a report selects the next report below it", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      // Walk the cursor down to "d" via the keyboard.
      act(() => {
        result.current.navigateReport(1, false); // a
        result.current.navigateReport(1, false); // b
        result.current.navigateReport(1, false); // c
        result.current.navigateReport(1, false); // d
      });
      expect(getSelection()).toEqual(["d"]);

      // Now click report "b" — this is the scenario from the bug report.
      plainClick("b");
      expect(getSelection()).toEqual(["b"]);

      // ArrowDown should land on "c" (neighbour of the clicked report),
      // NOT on "e" (where the keyboard cursor previously left off).
      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["c"]);
    });

    it("ArrowUp after clicking a report selects the previous report above it", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      // Drift the keyboard cursor first.
      act(() => {
        result.current.navigateReport(1, false); // a
        result.current.navigateReport(1, false); // b
      });

      // Click somewhere else.
      plainClick("d");

      act(() => {
        result.current.navigateReport(-1, false);
      });

      expect(getSelection()).toEqual(["c"]);
    });

    it("ArrowDown after cmd-clicking a new report continues from the cmd-clicked id", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      // Keyboard-select "a".
      act(() => {
        result.current.navigateReport(1, false);
      });
      expect(getSelection()).toEqual(["a"]);

      // Cmd-click "c" — extends the selection AND moves the click anchor to "c".
      cmdClick("c");
      expect(getSelection()).toEqual(["a", "c"]);
      expect(getLastClicked()).toBe("c");

      // ArrowDown should navigate from "c" (the cmd-clicked id), not from "a".
      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["d"]);
    });

    it("ArrowDown after shift-clicking continues from the shift-clicked id", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      // Plain-click "a" to set an anchor.
      plainClick("a");

      // Shift-click "c" — selects range a..c, anchor moves to c.
      shiftClick("c");
      expect(getSelection()).toEqual(["a", "b", "c"]);
      expect(getLastClicked()).toBe("c");

      // ArrowDown should navigate from "c".
      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["d"]);
    });

    it("ArrowDown after clearing selection starts from the top", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      act(() => {
        result.current.navigateReport(1, false); // a
        result.current.navigateReport(1, false); // b
      });
      act(() => {
        useInboxReportSelectionStore.getState().clearSelection();
      });

      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["a"]);
    });
  });

  describe("arrow navigation bounds", () => {
    it.each<[1 | -1, string]>([
      [1, "e"],
      [-1, "a"],
    ])(
      "direction %i at the boundary stays on the same report",
      (direction, reportId) => {
        const { result } = renderHook(() =>
          useInboxKeyboardNavigation({ reports: REPORTS }),
        );

        plainClick(reportId);

        act(() => {
          result.current.navigateReport(direction, false);
        });

        expect(getSelection()).toEqual([reportId]);
      },
    );
  });

  describe("shift+arrow range extension", () => {
    it("shift+ArrowDown after clicking extends a range from the clicked report", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      plainClick("b");

      act(() => {
        result.current.navigateReport(1, true);
      });

      expect(getSelection()).toEqual(["b", "c"]);
      // Anchor stays put even as the cursor walks.
      expect(getLastClicked()).toBe("b");
    });

    it("shift+ArrowDown walks the cursor without disturbing the anchor", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      plainClick("b");

      act(() => {
        result.current.navigateReport(1, true);
        result.current.navigateReport(1, true);
        result.current.navigateReport(1, true);
      });

      expect(getSelection()).toEqual(["b", "c", "d", "e"]);
      expect(getLastClicked()).toBe("b");
    });

    it("shift+ArrowUp contracts a range when reversing direction", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      plainClick("b");

      act(() => {
        result.current.navigateReport(1, true); // b..c
        result.current.navigateReport(1, true); // b..d
        result.current.navigateReport(-1, true); // b..c
      });

      expect(getSelection()).toEqual(["b", "c"]);
    });

    it("plain arrow after shift+arrow restarts navigation from the cursor", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      plainClick("b");
      act(() => {
        result.current.navigateReport(1, true); // b..c, cursor=c
        result.current.navigateReport(1, true); // b..d, cursor=d
      });
      expect(getSelection()).toEqual(["b", "c", "d"]);

      // Plain ArrowDown — selection collapses to the next item after the cursor.
      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["e"]);
    });

    it("click after shift+arrow re-seats the cursor at the clicked report", () => {
      const { result } = renderHook(() =>
        useInboxKeyboardNavigation({ reports: REPORTS }),
      );

      plainClick("b");
      act(() => {
        result.current.navigateReport(1, true); // cursor=c
        result.current.navigateReport(1, true); // cursor=d
      });

      // Click "a" — the cursor should re-seat there.
      plainClick("a");

      act(() => {
        result.current.navigateReport(1, false);
      });

      expect(getSelection()).toEqual(["b"]);
    });
  });
});

/**
 * Test harness that wires the hook the same way `InboxSignalsTab` does:
 * a window-level keydown handler, and row click handlers that mirror the
 * production plain/cmd/shift dispatch into the selection store.
 *
 * Lets us drive the real bug scenario via `fireEvent.click` + `fireEvent.keyDown`.
 */
function TestInbox({ reports }: { reports: SignalReport[] }) {
  const { navigateReport } = useInboxKeyboardNavigation({ reports });
  const selectedIds = useInboxReportSelectionStore((s) => s.selectedReportIds);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateReport(1, e.shiftKey);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateReport(-1, e.shiftKey);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateReport]);

  const handleClick = (id: string, e: React.MouseEvent) => {
    const store = useInboxReportSelectionStore.getState();
    if (e.shiftKey) {
      store.selectRange(
        id,
        reports.map((r) => r.id),
      );
    } else if (e.metaKey) {
      store.toggleReportSelection(id);
    } else {
      store.setSelectedReportIds([id]);
    }
  };

  return (
    <ul>
      {reports.map((r) => (
        <li
          key={r.id}
          data-testid={`report-${r.id}`}
          data-selected={selectedIds.includes(r.id) ? "true" : "false"}
        >
          <button type="button" onClick={(e) => handleClick(r.id, e)}>
            {r.id}
          </button>
        </li>
      ))}
    </ul>
  );
}

function getSelectedTestIds() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-selected="true"]'),
  ).map((el) => el.dataset.testid?.replace(/^report-/, "") ?? "");
}

describe("inbox keyboard navigation — full event pipeline", () => {
  beforeEach(() => {
    useInboxReportSelectionStore.setState({
      selectedReportIds: [],
      lastClickedId: null,
    });
  });

  // The literal scenario from the bug report: click a report, hit ArrowDown,
  // and it should select the report below — not the report below wherever the
  // keyboard cursor previously was.
  it("ArrowDown after clicking a report selects the report below it", () => {
    render(<TestInbox reports={REPORTS} />);

    // Drift the keyboard cursor down to "d".
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(getSelectedTestIds()).toEqual(["d"]);

    // Click "b".
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(getSelectedTestIds()).toEqual(["b"]);

    // ArrowDown should now select "c", not "e".
    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(getSelectedTestIds()).toEqual(["c"]);
  });

  it("ArrowUp after clicking a report selects the report above it", () => {
    render(<TestInbox reports={REPORTS} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(getSelectedTestIds()).toEqual(["b"]);

    fireEvent.click(screen.getByRole("button", { name: "d" }));

    fireEvent.keyDown(window, { key: "ArrowUp" });

    expect(getSelectedTestIds()).toEqual(["c"]);
  });

  it("Shift+ArrowDown after clicking extends a range from the clicked report", () => {
    render(<TestInbox reports={REPORTS} />);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });

    expect(getSelectedTestIds()).toEqual(["b", "c", "d"]);
  });

  it("Shift+ArrowUp contracts the range when direction reverses", () => {
    render(<TestInbox reports={REPORTS} />);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true }); // b..c
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true }); // b..d
    fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true }); // b..c

    expect(getSelectedTestIds()).toEqual(["b", "c"]);
  });

  it("Cmd+click moves the keyboard cursor to the cmd-clicked report", () => {
    render(<TestInbox reports={REPORTS} />);

    fireEvent.keyDown(window, { key: "ArrowDown" }); // a
    fireEvent.click(screen.getByRole("button", { name: "c" }), {
      metaKey: true,
    });
    expect(getSelectedTestIds()).toEqual(["a", "c"]);

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(getSelectedTestIds()).toEqual(["d"]);
  });

  it("Shift+click moves the anchor to the shift-clicked report", () => {
    render(<TestInbox reports={REPORTS} />);

    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "c" }), {
      shiftKey: true,
    });
    expect(getSelectedTestIds()).toEqual(["a", "b", "c"]);

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(getSelectedTestIds()).toEqual(["d"]);
  });

  it("ArrowDown from an empty list does nothing", () => {
    render(<TestInbox reports={[]} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(getSelectedTestIds()).toEqual([]);
  });
});
