import type { CatalogState, CategoryResponse, ProductResponse } from '@comanview/contracts';
type Source = {
  getCatalogState(): Promise<CatalogState>;
  getCategories(): Promise<CategoryResponse[]>;
  getProducts(): Promise<ProductResponse[]>;
};
const same = (a: CatalogState | null, b: CatalogState) =>
  a?.recoveryEpoch === b.recoveryEpoch && a.catalogGeneration === b.catalogGeneration;
const older = (a: CatalogState, b: CatalogState) =>
  a.recoveryEpoch < b.recoveryEpoch ||
  (a.recoveryEpoch === b.recoveryEpoch && a.catalogGeneration < b.catalogGeneration);
/** Catalog-only state machine: no access to orders, pending items, commands or tables. */
export class CatalogInvalidationController {
  private current: CatalogState | null = null;
  private snapshot: {
    state: CatalogState;
    categories: CategoryResponse[];
    products: ProductResponse[];
  } | null = null;
  getSnapshot() {
    return this.snapshot;
  }
  private target: CatalogState | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private stopped = false;
  private scheduled = false;
  constructor(
    private source: Source,
    private apply: (value: {
      state: CatalogState;
      categories: CategoryResponse[];
      products: ProductResponse[];
    }) => void,
    private unavailable: () => void = () => {},
  ) {}
  invalidate(target?: CatalogState) {
    if (this.stopped) return;
    if (target && (!this.target || older(this.target, target))) this.target = target;
    if (this.current && target && (older(target, this.current) || same(this.current, target)))
      return;
    this.dirty = true;
    if (!this.scheduled && !this.running) {
      this.scheduled = true;
      void Promise.resolve().then(() => {
        this.scheduled = false;
        return this.check();
      });
    }
  }
  check(force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (force) {
      this.current = null;
      this.dirty = true;
    }
    if (this.running) return this.running;
    this.running = this.refresh()
      .catch(() => {
        this.dirty = true;
        if (!this.stopped) this.unavailable();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async refresh() {
    // Bounded retries under a sustained burst. Further focus/reconnect/check recovers without polling.
    for (let attempt = 0; attempt < 3 && !this.stopped; attempt++) {
      this.dirty = false;
      const before = await this.source.getCatalogState();
      if (this.target && older(before, this.target)) {
        this.dirty = true;
        continue;
      }
      if (same(this.current, before)) return;
      const [categories, products] = await Promise.all([
        this.source.getCategories(),
        this.source.getProducts(),
      ]);
      const after = await this.source.getCatalogState();
      if (this.stopped) return;
      if (!same(before, after) || (this.target && older(after, this.target))) {
        this.dirty = true;
        continue;
      }
      this.current = after;
      this.target = after;
      this.snapshot = { state: after, categories, products };
      this.apply(this.snapshot);
      if (!this.dirty) return;
    }
  }
  stop() {
    this.stopped = true;
  }
}
