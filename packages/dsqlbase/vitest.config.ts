import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../node_modules/.vitest",
  test: {
    name: "dsqlbase",
    environment: "node",
    globals: true,
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ["src/**/*.types.test.ts"],
      tsconfig: "./tsconfig.test.json",
    },
    coverage: {
      reportsDirectory: "../../coverage/dsqlbase",
    },
  },
});
