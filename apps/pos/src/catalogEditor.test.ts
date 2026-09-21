import { describe, it, expect, vi } from 'vitest';
import type { EdgeClient } from '@comanview/client-sdk';
import {
  CatalogAttempt,
  createProductCommand,
  productDraft,
  productSavePlan,
  filterProducts,
  minorDecimal,
  rebaseProductDraft,
} from './catalogEditor.js';
import { allPermissions, catalogFixture, ids } from './catalogAdminFixtures.js';
describe('B2 product command orchestration', () => {
  it('manual rebase keeps local edits but adopts unrelated remote changes', () => {
    const f = catalogFixture(),
      p = f.products[0]!;
    const d = rebaseProductDraft(
      p,
      { ...productDraft(p), name: 'Local' },
      { ...p, description: 'Remota', available: false, version: 5 },
    );
    expect(d).toMatchObject({ name: 'Local', description: 'Remota', available: false });
  });
  it('uses sequential authoritative versions for details, category, price, tax, station and states', async () => {
    const f = catalogFixture(),
      draft = {
        ...productDraft(f.products[0]!),
        name: 'Té',
        categoryId: ids.otherCategory,
        price: '108.00',
        reason: 'Nuevo precio',
        taxId: ids.otherTax,
        stationId: ids.station,
        active: false,
        available: false,
      };
    const calls: { kind: string; expectedVersion: number }[] = [];
    let v = 4;
    const run = vi.fn(async (c: { kind: string; expectedVersion: number }) => {
      calls.push(c);
      return { version: ++v };
    });
    const edge = {
      ...f.edge,
      catalogCommand: run,
      executeTaxAdministration: run,
      executeRestaurantAdministration: run,
    } as unknown as EdgeClient;
    const plan = productSavePlan(edge, f.products[0]!, draft, f, allPermissions);
    await plan.run();
    expect(calls.map((c) => c.expectedVersion)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(plan.version).toBe(11);
    expect(plan.pending).toEqual([]);
  });
  it('retains exact command and acknowledged progress after lost ACK', async () => {
    const f = catalogFixture();
    let n = 0;
    const sent: unknown[] = [];
    const edge = {
      ...f.edge,
      catalogCommand: vi.fn(async (c: unknown) => {
        sent.push(c);
        n++;
        if (n === 2) throw Error('lost');
        return { version: n === 1 ? 5 : 6 };
      }),
    } as unknown as EdgeClient;
    const plan = productSavePlan(
      edge,
      f.products[0]!,
      { ...productDraft(f.products[0]!), name: 'Nuevo', price: '120', reason: 'Costo' },
      f,
      allPermissions,
    );
    await expect(plan.run()).rejects.toThrow('lost');
    expect(plan.completed).toEqual(['Información']);
    expect(plan.pending).toEqual(['Precio']);
    await plan.run();
    expect(sent[1]).toEqual(sent[2]);
    expect(sent).toHaveLength(3);
  });
  it('does not send concurrent duplicate plan commands', async () => {
    const f = catalogFixture();
    const plan = productSavePlan(
      f.edge as unknown as EdgeClient,
      f.products[0]!,
      { ...productDraft(f.products[0]!), available: false },
      f,
      allPermissions,
    );
    await Promise.all([plan.run(), plan.run()]);
    expect(f.edge.catalogCommand).toHaveBeenCalledTimes(1);
  });
  it('empty intent sends nothing', async () => {
    const f = catalogFixture();
    await productSavePlan(
      f.edge as unknown as EdgeClient,
      f.products[0]!,
      productDraft(f.products[0]!),
      f,
      allPermissions,
    ).run();
    expect(f.edge.catalogCommand).not.toHaveBeenCalled();
  });
  it('manager create omits explicit tax and station while preserving exact money', () => {
    const f = catalogFixture();
    const c = createProductCommand(
      { ...productDraft(f.products[0]!), price: '0,29', stationId: ids.station },
      f,
      ['CATALOG_MANAGE'],
    );
    expect(c).toMatchObject({
      payload: { basePrice: { amount: 29, currency: 'MXN' }, station: null },
    });
    expect(c.payload).not.toHaveProperty('taxProfile');
  });
  it('owner create captures reference versions', () => {
    const f = catalogFixture();
    expect(
      createProductCommand(
        { ...productDraft(f.products[0]!), stationId: ids.station },
        f,
        allPermissions,
      ),
    ).toMatchObject({
      payload: { category: { version: 1 }, taxProfile: { version: 1 }, station: { version: 2 } },
    });
  });
  it('does not permit tax or station changes without permission', () => {
    const f = catalogFixture();
    for (const d of [{ taxId: ids.otherTax }, { stationId: ids.station }])
      expect(() =>
        productSavePlan(
          f.edge as unknown as EdgeClient,
          f.products[0]!,
          { ...productDraft(f.products[0]!), ...d },
          f,
          [],
        ),
      ).toThrow('Tu rol');
  });
  it('validates exact price, order and reason before the first write', () => {
    const f = catalogFixture();
    for (const d of [{ price: '1.234' }, { displayOrder: '-1' }, { price: '20', reason: '' }])
      expect(() =>
        productSavePlan(
          f.edge as unknown as EdgeClient,
          f.products[0]!,
          { ...productDraft(f.products[0]!), ...d },
          f,
          allPermissions,
        ),
      ).toThrow();
    expect(f.edge.catalogCommand).not.toHaveBeenCalled();
    expect(minorDecimal(29)).toBe('0.29');
  });
  it('searches name SKU barcode and filters independently', () => {
    const f = catalogFixture();
    for (const q of ['café', 'cafe', '123456'])
      expect(filterProducts(f.products, q, '', 'true', 'true')).toHaveLength(1);
    expect(filterProducts(f.products, '', ids.otherCategory, '', '')).toHaveLength(0);
    expect(filterProducts(f.products, '', '', 'false', '')).toHaveLength(0);
    expect(filterProducts(f.products, '', '', '', 'false')).toHaveLength(0);
  });
  it('quick/category attempts cache ACK and retain command identity on retry', async () => {
    const f = catalogFixture();
    f.edge.catalogCommand.mockRejectedValueOnce(Error('lost'));
    const attempt = new CatalogAttempt({
      kind: 'CREATE_CATEGORY',
      commandId: crypto.randomUUID(),
      expectedVersion: 0,
      payload: { name: 'Bebidas' },
    });
    await expect(attempt.run(f.edge as unknown as EdgeClient)).rejects.toThrow();
    await attempt.run(f.edge as unknown as EdgeClient);
    await attempt.run(f.edge as unknown as EdgeClient);
    expect(f.edge.catalogCommand).toHaveBeenCalledTimes(2);
    expect(f.edge.catalogCommand.mock.calls[0]).toEqual(f.edge.catalogCommand.mock.calls[1]);
  });
});
