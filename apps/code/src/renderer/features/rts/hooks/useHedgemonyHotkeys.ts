import { useHotkeys } from "react-hotkeys-hook";
import type { ControlGroupSlot } from "../stores/controlGroupStore";
import type { BookmarkSlot } from "../stores/hedgemonyViewStore";

export interface HedgemonyHotkeyCallbacks {
  onToggleFullscreen: () => void;
  onToggleInAppFullscreen: () => void;
  onRecallBookmark: (slot: BookmarkSlot) => void;
  onSaveBookmark: (slot: BookmarkSlot) => void;
  onFitToContents: () => void;
  onResetView: () => void;
  onCenterSelected: () => void;
  onToggleBgmMute: () => void;
  onToggleSfxMute: () => void;
  onSelectBuilder: () => void;
  onSelectHedgehouse: () => void;
  onCycleNest: (direction: 1 | -1) => void;
  onRecallControlGroup: (slot: ControlGroupSlot) => void;
  onAssignControlGroup: (slot: ControlGroupSlot) => void;
}

export interface UseHedgemonyHotkeysOptions {
  /** When true, suppresses map-only bindings so typing in modals doesn't fire
   * fullscreen / bookmark recall. Audio bindings stay live (players want to
   * silence the hedgehog from anywhere). */
  dialogOpen: boolean;
}

/**
 * All map hotkeys in one place. The 1–9 control-group recall + assign
 * bindings are unrolled by hand because `useHotkeys` cannot be invoked in a
 * loop — each call must be a stable hook position in the render order.
 */
export function useHedgemonyHotkeys(
  callbacks: HedgemonyHotkeyCallbacks,
  options: UseHedgemonyHotkeysOptions,
): void {
  const {
    onToggleFullscreen,
    onToggleInAppFullscreen,
    onRecallBookmark,
    onSaveBookmark,
    onFitToContents,
    onResetView,
    onCenterSelected,
    onToggleBgmMute,
    onToggleSfxMute,
    onSelectBuilder,
    onSelectHedgehouse,
    onCycleNest,
    onRecallControlGroup,
    onAssignControlGroup,
  } = callbacks;

  const mapHotkeyOptions = {
    enableOnFormTags: false,
    preventDefault: true,
    enabled: !options.dialogOpen,
  } as const;

  useHotkeys("f, f11", onToggleFullscreen, mapHotkeyOptions, [
    onToggleFullscreen,
  ]);
  useHotkeys("shift+f", onToggleInAppFullscreen, mapHotkeyOptions, [
    onToggleInAppFullscreen,
  ]);

  useHotkeys("f5", () => onRecallBookmark(1), mapHotkeyOptions, [
    onRecallBookmark,
  ]);
  useHotkeys("f6", () => onRecallBookmark(2), mapHotkeyOptions, [
    onRecallBookmark,
  ]);
  useHotkeys("f7", () => onRecallBookmark(3), mapHotkeyOptions, [
    onRecallBookmark,
  ]);
  useHotkeys("shift+f5", () => onSaveBookmark(1), mapHotkeyOptions, [
    onSaveBookmark,
  ]);
  useHotkeys("shift+f6", () => onSaveBookmark(2), mapHotkeyOptions, [
    onSaveBookmark,
  ]);
  useHotkeys("shift+f7", () => onSaveBookmark(3), mapHotkeyOptions, [
    onSaveBookmark,
  ]);

  useHotkeys("z", onFitToContents, mapHotkeyOptions, [onFitToContents]);
  useHotkeys("shift+z", onResetView, mapHotkeyOptions, [onResetView]);
  useHotkeys("space", onCenterSelected, mapHotkeyOptions, [onCenterSelected]);

  useHotkeys("m", onToggleBgmMute, { preventDefault: true }, [onToggleBgmMute]);
  useHotkeys("shift+m", onToggleSfxMute, { preventDefault: true }, [
    onToggleSfxMute,
  ]);

  useHotkeys("f1", onSelectBuilder, mapHotkeyOptions, [onSelectBuilder]);
  useHotkeys("f2", onSelectHedgehouse, mapHotkeyOptions, [onSelectHedgehouse]);
  useHotkeys("f3", () => onCycleNest(1), mapHotkeyOptions, [onCycleNest]);
  useHotkeys("shift+f3", () => onCycleNest(-1), mapHotkeyOptions, [
    onCycleNest,
  ]);

  useHotkeys("1", () => onRecallControlGroup(1), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("2", () => onRecallControlGroup(2), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("3", () => onRecallControlGroup(3), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("4", () => onRecallControlGroup(4), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("5", () => onRecallControlGroup(5), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("6", () => onRecallControlGroup(6), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("7", () => onRecallControlGroup(7), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("8", () => onRecallControlGroup(8), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);
  useHotkeys("9", () => onRecallControlGroup(9), mapHotkeyOptions, [
    onRecallControlGroup,
  ]);

  useHotkeys("mod+shift+1", () => onAssignControlGroup(1), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+2", () => onAssignControlGroup(2), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+3", () => onAssignControlGroup(3), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+4", () => onAssignControlGroup(4), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+5", () => onAssignControlGroup(5), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+6", () => onAssignControlGroup(6), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+7", () => onAssignControlGroup(7), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+8", () => onAssignControlGroup(8), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
  useHotkeys("mod+shift+9", () => onAssignControlGroup(9), mapHotkeyOptions, [
    onAssignControlGroup,
  ]);
}
