import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// One-time onboarding flags for the Channels space. Persisted so the welcome
// callout that explains channels + canvases only shows until it's dismissed.
interface ChannelsOnboardingState {
  welcomeDismissed: boolean;
  dismissWelcome: () => void;
}

export const useChannelsOnboardingStore = create<ChannelsOnboardingState>()(
  persist(
    (set) => ({
      welcomeDismissed: false,
      dismissWelcome: () => set({ welcomeDismissed: true }),
    }),
    { name: "channels-onboarding-storage", storage: electronStorage },
  ),
);
