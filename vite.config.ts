import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
