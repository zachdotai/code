import { defineConfig } from "tsup";

// Bundle the extension into a single ESM file pi can load via
// `pi -e ./dist/extension.js` or `pi install`. The @posthog/* workspace
// packages export raw TypeScript, so they must be bundled (Node can't import
// .ts at runtime) — hence noExternal. pi-coding-agent is type-only here and is
// provided by the host pi runtime, so it stays external.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  clean: true,
  dts: false,
  sourcemap: true,
  external: ["@earendil-works/pi-coding-agent"],
  noExternal: [/^@posthog\//, "typebox"],
});
