import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import turbo from "eslint-config-turbo/flat";
import prettier from "eslint-config-prettier/flat";

export default defineConfig(
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  turbo,
  prettier,
);
