// @ts-check
import { base } from "./base.js";

/** @type {import("typescript-eslint").ConfigArray} */
export const react = [
  ...base,
  {
    rules: {
      // React-specific rules will be added when React packages are configured
    },
  },
];
