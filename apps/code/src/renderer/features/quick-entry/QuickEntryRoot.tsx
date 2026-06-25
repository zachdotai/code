import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { useThemeStore } from "@posthog/ui/shell/themeStore";
import { useEffect } from "react";
import { QuickEntryView } from "./QuickEntryView";

export function QuickEntryRoot() {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
  }, [isDarkMode]);

  return (
    <ErrorBoundary name="QuickEntry">
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <QuickEntryView />
      </div>
    </ErrorBoundary>
  );
}
