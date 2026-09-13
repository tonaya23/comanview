import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { matchesGlob } from 'node:path';
import { hostTestFiles } from '../apps/edge/test-host-files.mjs';
import parallel from '../apps/edge/vitest.config.mjs';
import host from '../apps/edge/vitest.host.config.mjs';

const root = new URL('../', import.meta.url);
const edge = new URL('apps/edge/', root);

test('every Edge test belongs to exactly one execution group', async () => {
  const files = (await readdir(new URL('src/', edge), { recursive: true }))
    .map((file) => `src/${file.replaceAll('\\', '/')}`)
    .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  assert.ok(files.length > hostTestFiles.length);
  assert.equal(new Set(hostTestFiles).size, hostTestFiles.length);
  for (const file of hostTestFiles) assert.ok(files.includes(file), `missing host test: ${file}`);
  for (const file of files) {
    const inParallel = !parallel.test.exclude.some((pattern) => matchesGlob(file, pattern));
    const inHost = host.test.include.some((pattern) => matchesGlob(file, pattern));
    assert.equal(Number(inParallel) + Number(inHost), 1, file);
  }
});

test('host group is serial, nonempty, and retains default timeout behaviour', () => {
  assert.deepEqual(host.test.include, hostTestFiles);
  assert.equal(host.test.fileParallelism, false);
  assert.equal(host.test.maxWorkers, 1);
  assert.equal(host.test.passWithNoTests, false);
  for (const config of [parallel, host]) {
    assert.equal(config.test.testTimeout, undefined);
    assert.equal(config.test.hookTimeout, undefined);
    assert.equal(config.test.testNamePattern, undefined);
  }
});

test('official pnpm test awaits Turbo before the mandatory, uncached host group', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const edgeManifest = JSON.parse(await readFile(new URL('package.json', edge), 'utf8'));
  assert.equal(manifest.scripts.test,
    'node --test scripts/test-execution.test.mjs && turbo run test && pnpm --filter @comanview/edge test:host');
  assert.equal(edgeManifest.scripts.test, 'vitest run --passWithNoTests');
  assert.equal(edgeManifest.scripts['test:host'], 'vitest run --config vitest.host.config.mjs');
});
