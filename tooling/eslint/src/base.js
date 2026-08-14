// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import("typescript-eslint").ConfigArray} */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.js", "*.mjs", "*.cjs"],
  },
);
