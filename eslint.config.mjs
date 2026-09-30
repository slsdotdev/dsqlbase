import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import turbo from "eslint-config-turbo/flat";
import prettier from "eslint-config-prettier/flat";

export default defineConfig(
  // A standalone Node script run by CI, outside every package; it has no TypeScript or Node
  // globals setup here and is not part of the published code.
  globalIgnores([".github/rulesets/check.mjs"]),
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  turbo,
  prettier,
  {
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  }
);
