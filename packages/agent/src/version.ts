declare const __AGENT_VERSION__: string | undefined;

// tsup injects the real version only for npm release builds (AGENT_RELEASE_BUILD=1);
// source builds (vite, vitest, dev tsup) keep the "latest source" sentinel.
export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ === "string" ? __AGENT_VERSION__ : "0.0.0-dev";
