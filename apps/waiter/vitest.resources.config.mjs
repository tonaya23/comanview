import { defineConfig } from 'vitest/config';
import { resourceTestFiles } from './test-resource-files.mjs';

export default defineConfig({
  test: {
    include: resourceTestFiles,
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
