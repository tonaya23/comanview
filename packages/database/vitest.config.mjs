import { configDefaults, defineConfig } from 'vitest/config';
import { resourceTestFiles } from './test-resource-files.mjs';

// Mandatory root pnpm test runs these files after Turbo and the native host group.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ...resourceTestFiles] },
});
