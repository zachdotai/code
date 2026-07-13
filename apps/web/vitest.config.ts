import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { trunkTestOptions } from "../../vitest.config.base";
import { posthogSrcAliases } from "./vite.aliases";

// Deliberately does NOT load vite.config.ts: that would run TanStackRouterVite
// and regenerate routeTree.gen.ts as a side effect of running tests. We only
// need the @posthog/* → src aliases, shared via vite.aliases.ts.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: posthogSrcAliases },
  test: {
    globals: true,
    ...trunkTestOptions,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
