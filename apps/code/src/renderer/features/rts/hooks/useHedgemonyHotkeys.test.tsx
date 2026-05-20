import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type HedgemonyHotkeyCallbacks,
  useHedgemonyHotkeys,
} from "./useHedgemonyHotkeys";

function makeCallbacks(): HedgemonyHotkeyCallbacks {
  return {
    onToggleFullscreen: vi.fn(),
    onToggleInAppFullscreen: vi.fn(),
    onRecallBookmark: vi.fn(),
    onSaveBookmark: vi.fn(),
    onFitToContents: vi.fn(),
    onResetView: vi.fn(),
    onCenterSelected: vi.fn(),
    onToggleBgmMute: vi.fn(),
    onToggleSfxMute: vi.fn(),
    onSelectBuilder: vi.fn(),
    onSelectHedgehouse: vi.fn(),
    onCycleNest: vi.fn(),
    onRecallControlGroup: vi.fn(),
    onAssignControlGroup: vi.fn(),
  };
}

function pressKey(init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent("keydown", init));
}

describe("useHedgemonyHotkeys", () => {
  it("fires onToggleFullscreen when 'f' is pressed", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "f" });
    expect(cbs.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("fires onSelectBuilder when F1 is pressed", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "F1" });
    expect(cbs.onSelectBuilder).toHaveBeenCalledTimes(1);
  });

  it("fires onCycleNest(1) on F3 and onCycleNest(-1) on Shift+F3", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "F3" });
    expect(cbs.onCycleNest).toHaveBeenCalledWith(1);
    pressKey({ key: "F3", shiftKey: true });
    expect(cbs.onCycleNest).toHaveBeenCalledWith(-1);
  });

  it("fires onRecallControlGroup with the correct slot for bare digits", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "1" });
    pressKey({ key: "5" });
    pressKey({ key: "9" });
    expect(cbs.onRecallControlGroup).toHaveBeenCalledWith(1);
    expect(cbs.onRecallControlGroup).toHaveBeenCalledWith(5);
    expect(cbs.onRecallControlGroup).toHaveBeenCalledWith(9);
  });

  it("fires onAssignControlGroup with the correct slot for mod+shift+digit", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "3", metaKey: true, shiftKey: true });
    expect(cbs.onAssignControlGroup).toHaveBeenCalledWith(3);
  });

  it("fires onRecallBookmark / onSaveBookmark on F5 / Shift+F5", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: false }));
    pressKey({ key: "F5" });
    expect(cbs.onRecallBookmark).toHaveBeenCalledWith(1);
    pressKey({ key: "F6", shiftKey: true });
    expect(cbs.onSaveBookmark).toHaveBeenCalledWith(2);
  });

  it("suppresses map hotkeys when dialogOpen is true but keeps audio live", () => {
    const cbs = makeCallbacks();
    renderHook(() => useHedgemonyHotkeys(cbs, { dialogOpen: true }));
    pressKey({ key: "f" });
    expect(cbs.onToggleFullscreen).not.toHaveBeenCalled();
    pressKey({ key: "F1" });
    expect(cbs.onSelectBuilder).not.toHaveBeenCalled();
    pressKey({ key: "m" });
    expect(cbs.onToggleBgmMute).toHaveBeenCalledTimes(1);
  });
});
