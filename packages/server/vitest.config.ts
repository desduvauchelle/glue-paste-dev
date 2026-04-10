import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "bun:test": "vitest",
      "bun:sqlite": new URL("src/__mocks__/bun-sqlite.ts", import.meta.url).pathname,
    },
  },
});
