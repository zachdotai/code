import { router } from "@renderer/router";
import { create } from "zustand";

export type SettingsCategory =
  | "general"
  | "plan-usage"
  | "workspaces"
  | "worktrees"
  | "environments"
  | "cloud-environments"
  | "personalization"
  | "terminal"
  | "claude-code"
  | "shortcuts"
  | "github"
  | "slack"
  | "signals"
  | "updates"
  | "advanced";

interface SettingsDialogContext {
  repoPath?: string;
}

interface SettingsDialogState {
  isOpen: boolean;
  activeCategory: SettingsCategory;
  context: SettingsDialogContext;
  initialAction: string | null;
  formMode: boolean;
}

interface SettingsDialogActions {
  open: (
    category?: SettingsCategory,
    contextOrAction?: SettingsDialogContext | string,
  ) => void;
  close: () => void;
  setCategory: (category: SettingsCategory) => void;
  clearContext: () => void;
  consumeInitialAction: () => string | null;
  setFormMode: (formMode: boolean) => void;
}

type SettingsDialogStore = SettingsDialogState & SettingsDialogActions;

export const useSettingsDialogStore = create<SettingsDialogStore>()(
  (set, get) => ({
    isOpen: false,
    activeCategory: "general",
    context: {},
    initialAction: null,
    formMode: false,

    open: (category, contextOrAction) => {
      if (!get().isOpen) {
        window.history.pushState({ settingsOpen: true }, "");
      }
      const isAction = typeof contextOrAction === "string";
      const nextCategory = category ?? get().activeCategory;
      set({
        isOpen: true,
        activeCategory: nextCategory,
        context: isAction ? {} : (contextOrAction ?? {}),
        initialAction: isAction ? contextOrAction : null,
        formMode: false,
      });
      void router.navigate({
        to: "/settings/$category",
        params: { category: nextCategory },
      });
    },
    close: () => {
      const wasOpen = get().isOpen;
      if (wasOpen && window.history.state?.settingsOpen) {
        window.history.back();
      }
      set({
        isOpen: false,
        context: {},
        initialAction: null,
        formMode: false,
      });
      if (wasOpen) {
        const matches = router.state.matches;
        const onSettings = matches.some((m) =>
          m.routeId.startsWith("/settings"),
        );
        if (onSettings) {
          void router.navigate({ to: "/code" });
        }
      }
    },
    setCategory: (category) => {
      set({ activeCategory: category, initialAction: null, formMode: false });
      void router.navigate({
        to: "/settings/$category",
        params: { category },
      });
    },
    clearContext: () => set({ context: {} }),
    consumeInitialAction: () => {
      const action = get().initialAction;
      if (action) set({ initialAction: null });
      return action;
    },
    setFormMode: (formMode) => set({ formMode }),
  }),
);
