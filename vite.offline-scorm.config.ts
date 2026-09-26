import { defineConfig } from "vite";

const offlineEntries = {
  "application-offline": "src/offline-scorm/application-offline.ts",
  "learning-runtime": "src/offline-scorm/learning-runtime.ts",
  "learning-worker": "src/offline-scorm/learning-worker.ts",
  "package-runtime": "src/offline-scorm/package-runtime.ts",
  "package-worker": "src/offline-scorm/package-worker.ts",
};
const offlineEntryIds = new Set(
  Object.values(offlineEntries).map(
    (entry) => new URL(entry, import.meta.url).pathname,
  ),
);

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "#": new URL("./src", import.meta.url).pathname,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "dist/offline-scorm",
    sourcemap: false,
    minify: "oxc",
    lib: {
      entry: offlineEntries,
      formats: ["es"],
      cssFileName: "application-offline",
    },
    rollupOptions: {
      output: {
        chunkFileNames: "[name].js",
        entryFileNames: "[name].js",
        manualChunks(id) {
          const [moduleId = id] = id.split("?");
          return offlineEntryIds.has(moduleId) ? undefined : "shared";
        },
      },
    },
  },
});
