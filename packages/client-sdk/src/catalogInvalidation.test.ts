import { expect, it, vi } from 'vitest';
import { CatalogInvalidationController } from './catalogInvalidation.js';
import type { CatalogState, ProductResponse } from '@comanview/contracts';
const state = (generation = 1, epoch = 0): CatalogState => ({
  catalogGeneration: generation,
  recoveryEpoch: epoch,
  capabilityVersion: 1,
});
function fixture() {
  let current = state();
  const source = {
    getCatalogState: vi.fn(async () => current),
    getCategories: vi.fn(async () => []),
    getProducts: vi.fn(async () => [] as ProductResponse[]),
  };
  const apply = vi.fn(),
    unavailable = vi.fn(),
    controller = new CatalogInvalidationController(source, apply, unavailable);
  return {
    source,
    apply,
    unavailable,
    controller,
    set: (s: CatalogState) => {
      current = s;
    },
  };
}
it('same-generation reconnect uses only state; missed event/focus and new epoch with lower generation refetch', async () => {
  const f = fixture();
  f.set(state(100, 7));
  await f.controller.check();
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(1);
  f.set(state(101, 7));
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(2);
  f.set(state(30, 8));
  await f.controller.check();
  expect(f.apply.mock.calls.at(-1)?.[0].state).toEqual(state(30, 8));
  f.controller.invalidate(state(999, 7));
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(3);
});
it('coalesces bursts, discards in-flight stale data, and keeps only one load in flight', async () => {
  const f = fixture();
  let resolve!: (p: ProductResponse[]) => void;
  f.source.getProducts.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const request = f.controller.check();
  await Promise.resolve();
  for (let i = 2; i <= 20; i++) f.controller.invalidate(state(i));
  f.set(state(20));
  expect(f.source.getProducts).toHaveBeenCalledTimes(1);
  resolve([]);
  await request;
  expect(f.source.getProducts).toHaveBeenCalledTimes(2);
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.apply.mock.calls[0]?.[0].state).toEqual(state(20));
});
it('degraded HTTP preserves existing consumer state and recovers on resume; stopped requests cannot apply', async () => {
  const f = fixture();
  await f.controller.check();
  f.source.getCatalogState.mockRejectedValueOnce(new Error('Unavailable'));
  await f.controller.check();
  expect(f.unavailable).toHaveBeenCalledTimes(1);
  expect(f.apply).toHaveBeenCalledTimes(1);
  f.set(state(2));
  await f.controller.check();
  expect(f.apply).toHaveBeenCalledTimes(2);
  f.set(state(3));
  const pending = f.controller.check();
  f.controller.stop();
  await pending;
  expect(f.apply).toHaveBeenCalledTimes(2);
});
it('coalesces a synchronous notification burst and allows an explicit authoritative refresh', async () => {
  const f = fixture();
  f.set(state(100));
  for (let generation = 1; generation <= 100; generation++)
    f.controller.invalidate(state(generation));
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot()?.state).toEqual(state(100));
  await f.controller.check(true);
  expect(f.source.getProducts).toHaveBeenCalledTimes(2);
  expect(f.controller.getSnapshot()?.state).toEqual(state(100));
});
it('bounds churn at three attempts and recovers on the next focus/check without polling', async () => {
  const f = fixture();
  await f.controller.check();
  let generation = 2;
  f.source.getCatalogState.mockImplementation(async () => state(generation++));
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(4);
  expect(f.apply).toHaveBeenCalledTimes(1); // All three inconsistent reads discarded.
  await Promise.resolve(); await Promise.resolve();
  expect(f.source.getProducts).toHaveBeenCalledTimes(4); // No background retry loop.
  f.source.getCatalogState.mockImplementation(async () => state(20));
  await f.controller.check();
  expect(f.source.getProducts).toHaveBeenCalledTimes(5);
  expect(f.controller.getSnapshot()?.state).toEqual(state(20));
});
