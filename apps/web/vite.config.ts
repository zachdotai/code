import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (name: string) => path.resolve(dir, `../../packages/${name}/src`);

// Mirror apps/code's vite.shared.mts: resolve @posthog/<pkg>/<sub> to package src,
// since the packages' array-fallback `exports` don't resolve under Rollup.
const subpath = (name: string) => ({
  find: new RegExp(`^@posthog/${name}/(.+)$`),
  replacement: `${src(name)}/$1`,
});

// Peel the biggest statically-imported vendors out of the single ~8.6 MB entry
// chunk into cacheable groups so the browser downloads them in parallel and
// re-uses them across deploys (app code changes far more often). Coarse,
// well-separated groups only — aggressive splitting risks cross-chunk
// init-order bugs.
//
// IMPORTANT: only NAMED groups are returned; everything else falls through to
// `undefined` (Rollup's default). A catch-all `return "vendor"` would force
// DYNAMICALLY-imported deps — above all the Shiki language grammars, which are
// already lazy per-language chunks — into one eager chunk, defeating their
// code-splitting (it ballooned a "vendor" chunk to ~11 MB). Leaving them
// undefined preserves their lazy chunks.
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  // Shiki grammars/themes are dynamically imported per language — never group
  // them, or they collapse into one eager chunk.
  if (id.includes("shiki") || id.includes("@shikijs")) return undefined;
  const inPkg = (...names: string[]) =>
    names.some((n) => id.includes(`node_modules/${n}`));
  // React must stay a single instance — keep it (and its runtime deps) together.
  if (inPkg("react/", "react-dom/", "react/jsx-runtime", "scheduler/"))
    return "react";
  // posthog-js bundles rrweb (session recording) — the single largest dependency.
  if (inPkg("posthog-js", "rrweb", "@rrweb")) return "posthog-js";
  if (inPkg("@codemirror", "@lezer", "codemirror")) return "codemirror";
  if (inPkg("@tiptap", "prosemirror")) return "tiptap";
  if (inPkg("@xterm", "xterm")) return "xterm";
  if (inPkg("@tanstack")) return "tanstack";
  if (inPkg("@radix-ui", "@posthog/quill", "@base-ui", "@floating-ui"))
    return "ui-vendor";
  if (inPkg("@anthropic-ai", "@agentclientprotocol")) return "agent-sdk";
  return undefined;
}

export default defineConfig({
  plugins: [
    // Splits each route's component into its own lazy chunk (autoCodeSplitting),
    // so the browser only downloads a screen's code when it's navigated to. Must
    // precede react() so it transforms the route files first. Points at the same
    // shared routes dir + generated tree as apps/code's electron.vite.config.ts,
    // so both hosts produce an identical routeTree.gen.ts.
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: path.resolve(dir, "../../packages/ui/src/router/routes"),
      generatedRouteTree: path.resolve(
        dir,
        "../../packages/ui/src/router/routeTree.gen.ts",
      ),
    }),
    react(),
    tailwindcss(),
  ],
  // Load .env from the repo root (mirrors apps/code's loadEnv(mode, "../..")) so
  // VITE_POSTHOG_API_KEY / _HOST / _UI_HOST resolve here just as they do on
  // desktop. Without this, envDir defaults to apps/web (no .env) and posthog-js
  // never gets a key.
  envDir: path.resolve(dir, "../.."),
  resolve: {
    alias: [
      subpath("di"),
      subpath("ui"),
      subpath("core"),
      subpath("shared"),
      subpath("host-router"),
      subpath("host-trpc"),
      subpath("platform"),
      subpath("workspace-client"),
      subpath("api-client"),
      subpath("agent"),
      subpath("enricher"),
    ],
  },
  server: { port: 5273 },
  build: {
    rollupOptions: { output: { manualChunks } },
  },
});
