import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    exclude: ["deploy/cdk/**", "e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
      exclude: [
        "deploy/cdk/**",
        "e2e/**",
        "src/routeTree.gen.ts",
        "src/routes/**",
        "src/router.tsx",
      ],
    },
  },
});
