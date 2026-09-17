import { configDefaults, defineConfig } from 'vitest/config';
import { hostTestFiles } from './test-host-files.mjs';
import { resourceTestFiles } from './test-resource-files.mjs';

// Root pnpm test runs resource and host groups, in sequence, AFTER Turbo completes.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...hostTestFiles, ...resourceTestFiles],
  },
});
