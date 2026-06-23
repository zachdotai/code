import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const mockPlaySound = vi.hoisted(() => vi.fn());

vi.mock("@posthog/ui/primitives/toast", () => ({ toast: mockToast }));
vi.mock("@posthog/ui/utils/sounds", () => ({
  playCompletionSound: mockPlaySound,
}));
vi.mock("@posthog/ui/features/settings/settingsStore", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ completionSound: "drop", completionVolume: 80 }),
}));

import { useCanvasReadyCelebration } from "./useCanvasReadyCelebration";

describe("useCanvasReadyCelebration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays silent when no generation was ever in flight", () => {
    const { result } = renderHook(() =>
      useCanvasReadyCelebration({
        code: "<App/>",
        isGenerating: false,
        canvasName: "Sales",
      }),
    );
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
    expect(result.current.justRevealed).toBe(false);
  });

  it("celebrates a first build with the 'ready' copy + chime + reveal", () => {
    const { result, rerender } = renderHook(
      (props: { code: string; isGenerating: boolean }) =>
        useCanvasReadyCelebration({ ...props, canvasName: "Sales" }),
      { initialProps: { code: "", isGenerating: true } },
    );

    // Still generating: nothing yet.
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(result.current.justRevealed).toBe(false);

    // Generation settles with published code.
    act(() => rerender({ code: "<App/>", isGenerating: false }));

    expect(mockToast.success).toHaveBeenCalledWith("✨ Canvas ready", {
      description: '"Sales" is ready to explore.',
    });
    expect(mockPlaySound).toHaveBeenCalledWith("drop", 80);
    expect(result.current.justRevealed).toBe(true);
  });

  it("uses the 'updated' copy when the canvas already had code", () => {
    const { rerender } = renderHook(
      (props: { code: string; isGenerating: boolean }) =>
        useCanvasReadyCelebration({ ...props, canvasName: "Sales" }),
      { initialProps: { code: "<Old/>", isGenerating: true } },
    );

    act(() => rerender({ code: "<New/>", isGenerating: false }));

    expect(mockToast.success).toHaveBeenCalledWith("✨ Canvas updated", {
      description: '"Sales" is ready to explore.',
    });
  });

  it("does not fire while still generating even if code streams in", () => {
    const { rerender } = renderHook(
      (props: { code: string; isGenerating: boolean }) =>
        useCanvasReadyCelebration({ ...props, canvasName: "" }),
      { initialProps: { code: "", isGenerating: true } },
    );

    // Code present but generation not yet settled.
    act(() => rerender({ code: "<App/>", isGenerating: true }));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
