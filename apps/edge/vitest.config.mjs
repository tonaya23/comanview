import { configDefaults, defineConfig } from 'vitest/config';
import { hostTestFiles } from './test-host-files.mjs';

// Root pnpm test runs the excluded files in test:host AFTER Turbo completes.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...hostTestFiles],
  },
});
