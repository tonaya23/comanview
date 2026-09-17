import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { matchesGlob } from 'node:path';
import { hostTestFiles } from '../apps/edge/test-host-files.mjs';
import parallel from '../apps/edge/vitest.config.mjs';
import host from '../apps/edge/vitest.host.config.mjs';
import edgeResources from '../apps/edge/vitest.resources.config.mjs';
import { resourceTestFiles as edgeFiles } from '../apps/edge/test-resource-files.mjs';
import databaseParallel from '../packages/database/vitest.config.mjs';
import databaseResources from '../packages/database/vitest.resources.config.mjs';
import { resourceTestFiles as databaseFiles } from '../packages/database/test-resource-files.mjs';
import posParallel from '../apps/pos/vitest.config.mjs';
import posResources from '../apps/pos/vitest.resources.config.mjs';
import { resourceTestFiles as posFiles } from '../apps/pos/test-resource-files.mjs';
import waiterParallel from '../apps/waiter/vitest.config.mjs';
import waiterResources from '../apps/waiter/vitest.resources.config.mjs';
import { resourceTestFiles as waiterFiles } from '../apps/waiter/test-resource-files.mjs';
import superAdminParallel from '../apps/super-admin/vitest.config.mjs';
import superAdminResources from '../apps/super-admin/vitest.resources.config.mjs';
import { resourceTestFiles as superAdminFiles } from '../apps/super-admin/test-resource-files.mjs';

const root = new URL('../', import.meta.url);
const edge = new URL('apps/edge/', root);

test('every Edge test belongs to exactly one execution group', async () => {
  const files = (await readdir(new URL('src/', edge), { recursive: true }))
    .map((file) => `src/${file.replaceAll('\\', '/')}`)
    .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  assert.ok(files.length > hostTestFiles.length);
  assert.equal(new Set(hostTestFiles).size, hostTestFiles.length);
  for (const file of hostTestFiles) assert.ok(files.includes(file), `missing host test: ${file}`);
  assert.ok(edgeFiles.length > 0);
  assert.equal(new Set(edgeFiles).size, edgeFiles.length);
  assert.deepEqual(edgeResources.test.include, edgeFiles);
  for (const file of edgeFiles) assert.ok(files.includes(file), `missing resource test: ${file}`);
  for (const file of files) {
    const inParallel = !parallel.test.exclude.some((pattern) => matchesGlob(file, pattern));
    const inHost = host.test.include.some((pattern) => matchesGlob(file, pattern));
    const inResources = edgeResources.test.include.some((pattern) => matchesGlob(file, pattern));
    assert.equal(Number(inParallel) + Number(inHost) + Number(inResources), 1, file);
  }
});

test('host group is serial, nonempty, and retains default timeout behaviour', () => {
  assert.deepEqual(host.test.include, hostTestFiles);
  assert.equal(host.test.fileParallelism, false);
  assert.equal(host.test.maxWorkers, 1);
  assert.equal(host.test.passWithNoTests, false);
  for (const config of [host, edgeResources]) {
    assert.equal(config.test.fileParallelism, false);
    assert.equal(config.test.maxWorkers, 1);
    assert.equal(config.test.passWithNoTests, false);
  }
  for (const config of [parallel, host, edgeResources]) {
    assert.equal(config.test.testTimeout, undefined);
    assert.equal(config.test.hookTimeout, undefined);
    assert.equal(config.test.testNamePattern, undefined);
    assert.equal(config.test.retry, undefined);
  }
});

test('official pnpm test awaits Turbo before the mandatory, uncached host group', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const edgeManifest = JSON.parse(await readFile(new URL('package.json', edge), 'utf8'));
  assert.equal(manifest.scripts.test,
    'node --test scripts/test-execution.test.mjs && turbo run test && pnpm --filter @comanview/edge test:resources && pnpm --filter @comanview/edge test:host && pnpm --filter @comanview/database test:resources && pnpm --filter @comanview/pos test:resources && pnpm test:ui-resources');
  assert.equal(manifest.scripts['test:ui-resources'],
    'pnpm --filter @comanview/waiter test:resources && pnpm --filter @comanview/super-admin test:resources');
  assert.equal(edgeManifest.scripts.test, 'vitest run --passWithNoTests');
  assert.equal(edgeManifest.scripts['test:host'], 'vitest run --config vitest.host.config.mjs');
  assert.equal(edgeManifest.scripts['test:resources'], 'vitest run --config vitest.resources.config.mjs');
});

for (const [directory, parallelConfig, resourceConfig, isolatedFiles] of [
  ['packages/database/', databaseParallel, databaseResources, databaseFiles],
  ['apps/pos/', posParallel, posResources, posFiles],
  ['apps/waiter/', waiterParallel, waiterResources, waiterFiles],
  ['apps/super-admin/', superAdminParallel, superAdminResources, superAdminFiles],
]) {
  test(`${directory}: every test belongs to exactly one mandatory execution group`, async () => {
    const workspace = new URL(directory, root);
    const files = (await readdir(new URL('src/', workspace), { recursive: true }))
      .map((file) => `src/${file.replaceAll('\\', '/')}`)
      .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
    assert.ok(isolatedFiles.length > 0 && files.length > isolatedFiles.length);
    assert.equal(new Set(isolatedFiles).size, isolatedFiles.length);
    for (const file of isolatedFiles) assert.ok(files.includes(file), `missing resource test: ${file}`);
    for (const file of files) {
      const normal = !parallelConfig.test.exclude.some((pattern) => matchesGlob(file, pattern));
      const isolated = resourceConfig.test.include.some((pattern) => matchesGlob(file, pattern));
      assert.equal(Number(normal) + Number(isolated), 1, file);
    }
    assert.deepEqual(resourceConfig.test.include, isolatedFiles);
    assert.equal(resourceConfig.test.fileParallelism, false);
    assert.equal(resourceConfig.test.maxWorkers, 1);
    assert.equal(resourceConfig.test.passWithNoTests, false);
    for (const config of [parallelConfig, resourceConfig]) {
      assert.equal(config.test.testTimeout, undefined);
      assert.equal(config.test.hookTimeout, undefined);
      assert.equal(config.test.testNamePattern, undefined);
    }
    const manifest = JSON.parse(await readFile(new URL('package.json', workspace), 'utf8'));
    assert.equal(manifest.scripts.test, 'vitest run --passWithNoTests');
    assert.equal(manifest.scripts['test:resources'], 'vitest run --config vitest.resources.config.mjs');
  });
}
