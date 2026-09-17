import { configDefaults, defineConfig } from 'vitest/config';
import { resourceTestFiles } from './test-resource-files.mjs';

// Root pnpm test executes the excluded files in the mandatory post-Turbo resource group.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ...resourceTestFiles] },
});
