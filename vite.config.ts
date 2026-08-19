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
      compress: { passes: 3 },
      format: { comments: false },
      module: true,
    },
    // Runtime artifacts stay non-symbolic. A future Datadog CI step must
    // generate and upload private maps before packaging the release.
    sourcemap: false,
  },
});
