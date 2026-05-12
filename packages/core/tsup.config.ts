import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/client.ts",
    "src/config.ts",
    "src/credentials.ts",
    "src/oauth.ts",
    "src/sse-parser.ts",
    "src/types.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
});
