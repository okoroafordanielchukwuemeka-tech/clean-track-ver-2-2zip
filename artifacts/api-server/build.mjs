/**
 * Production build script for the CleanTrack API server.
 *
 * Uses esbuild to compile TypeScript and bundle @workspace/* packages inline
 * while keeping all real npm packages external (Railway installs them via
 * `pnpm install --prod`).
 *
 * Output: dist/index.js  (ESM, Node 20 target)
 */

import { build } from "esbuild";
import { rmSync } from "fs";

rmSync("dist", { recursive: true, force: true });

console.log("[build] Bundling API server with esbuild...");

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,

  /**
   * Plugin: keep all real npm packages external but bundle @workspace/* packages.
   *
   * Why: @workspace/db exports raw TypeScript source files. Node.js cannot
   * execute .ts files at runtime, so it must be compiled inline. All other
   * packages ship pre-compiled JS and will be present in node_modules on
   * the Railway deployment host after `pnpm install`.
   */
  plugins: [
    {
      name: "external-npm-packages",
      setup(build) {
        // Match any bare package specifier (not a relative path, not node:*)
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          // Let @workspace/* packages be bundled inline
          if (args.path.startsWith("@workspace/")) return undefined;
          // Mark everything else external
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

console.log("[build] ✓ Build complete → dist/index.js");
