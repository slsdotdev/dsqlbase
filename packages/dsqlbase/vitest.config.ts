import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../node_modules/.vitest",
  test: {
    name: "dsqlbase",
    environment: "node",
    globals: true,
    passWithNoTests: true,
    coverage: {
      reportsDirectory: "../../coverage/dsqlbase",
    },
  },
});
