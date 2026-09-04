import { readFileSync } from "node:fs";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bundleBudgets = JSON.parse(
  readFileSync(
    new URL("./config/bundle-budgets.json", import.meta.url),
    "utf8",
  ),
) as { conditionalJavaScriptGzipBytes?: Record<string, number> };
const namedConditionalChunks = new Set(
  Object.keys(bundleBudgets.conditionalJavaScriptGzipBytes ?? {}),
);

export default defineConfig({
  plugins: [tanstackStart(), react()],
  resolve: {
    alias: {
      "#": new URL("./src", import.meta.url).pathname,
    },
  },
  build: {
    minify: "terser",
    terserOptions: {
      compress: { passes: 5 },
      format: { comments: false },
      module: true,
    },
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) =>
          namedConditionalChunks.has(chunk.name) ||
          chunk.name.startsWith("_tanstack-start-manifest_v")
            ? "assets/[name]-[hash].js"
            : "assets/[hash].js",
        codeSplitting: {
          groups: [
            // Keep React separate from the framework chunk so shared vendor
            // code remains ordered without folding conditional app UI inward.
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
              priority: 2,
            },
            {
              name: "tanstack-vendor",
              test: /node_modules[\\/]@tanstack[\\/]/u,
              priority: 1,
            },
          ],
        },
      },
    },
    // Runtime artifacts stay non-symbolic. A future Datadog CI step must
    // generate and upload private maps before packaging the release.
    sourcemap: false,
  },
});
