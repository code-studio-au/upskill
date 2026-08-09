import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "#": new URL("./src", import.meta.url).pathname,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "dist/worker",
    sourcemap: false,
    ssr: "src/worker/scorm-worker.ts",
    rollupOptions: {
      output: {
        entryFileNames: "scorm-worker.js",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
