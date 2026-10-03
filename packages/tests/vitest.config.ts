import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../node_modules/.vitest",
  test: {
    name: "tests",
    environment: "node",
    globals: true,
    passWithNoTests: true,
    // Every spec boots a fresh PGlite (~0.5 s each); under a loaded runner that alone can pass
    // vitest's 5 s unit-test default. See docs/internals/testing.md.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      reportsDirectory: "../../coverage/tests",
    },
  },
});
