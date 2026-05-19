import { create } from "zustand";

interface McpUiToolsState {
  toolKeys: Set<string>;
  isReady: boolean;
  setToolKeys: (keys: readonly string[]) => void;
}

export const useMcpUiToolsStore = create<McpUiToolsState>((set) => ({
  toolKeys: new Set<string>(),
  isReady: false,
  setToolKeys: (keys) => set({ toolKeys: new Set(keys), isReady: true }),
}));
