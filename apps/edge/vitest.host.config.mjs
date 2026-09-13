import { defineConfig } from 'vitest/config';
import { hostTestFiles } from './test-host-files.mjs';

export default defineConfig({
  test: {
    include: hostTestFiles,
    fileParallelism: false,
    maxWorkers: 1,
    // An empty/misconfigured group must fail, not silently certify the host.
    passWithNoTests: false,
  },
});
