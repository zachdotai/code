import { vi } from "vitest";

// jsdom leaves several browser globals that the web composition root touches at
// import time undefined. Provide minimal stand-ins so importing web-container.ts
// (and the stores it pulls in) doesn't throw before the container is built.

// localStorage: several per-device stores read it at module init.
if (typeof window.localStorage?.setItem !== "function") {
  const store = new Map<string, string>();
  const localStoragePolyfill: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStoragePolyfill,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStoragePolyfill,
  });
}

// matchMedia: UI stores (e.g. themeStore) read it at module load.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
