import {
  type SettingsCategory,
  useSettingsDialogStore,
} from "@features/settings/stores/settingsDialogStore";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

const VALID_CATEGORIES: SettingsCategory[] = [
  "general",
  "plan-usage",
  "workspaces",
  "worktrees",
  "environments",
  "cloud-environments",
  "personalization",
  "terminal",
  "claude-code",
  "shortcuts",
  "github",
  "slack",
  "signals",
  "updates",
  "advanced",
];

export const Route = createFileRoute("/settings/$category")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { category } = Route.useParams();

  useEffect(() => {
    const cat = VALID_CATEGORIES.includes(category as SettingsCategory)
      ? (category as SettingsCategory)
      : "general";
    const store = useSettingsDialogStore.getState();
    if (!store.isOpen || store.activeCategory !== cat) {
      store.open(cat);
    }
    return () => {
      // Closing here would trigger close()'s navigate-to-/code, which is the
      // desired behavior when the user navigates away from the settings URL.
      // The dialog component closes itself on Escape; this cleanup only fires
      // when the route is unmounted by router navigation.
      const current = useSettingsDialogStore.getState();
      if (current.isOpen && current.activeCategory === cat) {
        useSettingsDialogStore.setState({ isOpen: false });
      }
    };
  }, [category]);

  return null;
}
