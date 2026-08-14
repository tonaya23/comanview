// @ts-check
import { base } from "./base.js";

/** @type {import("typescript-eslint").ConfigArray} */
export const node = [
  ...base,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
];
