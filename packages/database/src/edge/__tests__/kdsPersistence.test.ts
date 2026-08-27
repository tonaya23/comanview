import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EntityId,
  KdsInvalidTransitionError,
  ModifierSnapshot,
  Order,
  ProductSnapshot,
} from '@comanview/domain';
import { Money } from '@comanview/money';
import { createEdgeDatabase } from '../db.js';
import { prepareDevelopmentDatabase } from '../prepareDevelopmentDatabase.js';
import { KdsRepository } from '../repositories/KdsRepository.js';
import { OrderRepository } from '../repositories/OrderRepository.js';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const candidate of [path, `${path}-shm`, `${path}-wal`]) {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }
});

function makeDatabase() {
  const path = join(tmpdir(), `comanview-kds-${Date.now()}-${Math.random()}.db`);
  paths.push(path);
  prepareDevelopmentDatabase(path);
  return { path, handle: createEdgeDatabase(path) };
}

describe('KDS persistence projection', () => {
  it('derives station slices from immutable SENT snapshots and survives restart', () => {
    const { path, handle } = makeDatabase();
    const kitchenId = EntityId.fromString('01991a00-0000-7000-8000-000000000501');
    const barId = EntityId.fromString('01991a00-0000-7000-8000-000000000502');
    const order = Order.create({
      tenantId: EntityId.generate(),
      locationId: EntityId.generate(),
      orderType: 'COUNTER',
      orderChannel: 'POS',
      orderNumber: 'KDS-1',
      currency: 'MXN',
    });
    const modifier = new ModifierSnapshot({
      id: EntityId.generate(),
      name: 'Queso extra',
      priceDelta: Money.fromMinorUnits(500, 'MXN'),
    });
    order.addItem(
      new ProductSnapshot({
        productId: EntityId.generate(),
        productName: 'Hamburguesa snapshot',
        basePrice: Money.fromMinorUnits(12000, 'MXN'),
        taxRateBasisPoints: 1600,
        taxCalculationMode: 'TAX_INCLUDED',
        stationId: kitchenId,
        modifiers: [modifier],
      }),
      'add-kitchen',
      'solo una rodaja de tomate',
    );
    order.addItem(
      new ProductSnapshot({
        productId: EntityId.generate(),
        productName: 'Limonada snapshot',
        basePrice: Money.fromMinorUnits(4500, 'MXN'),
        taxRateBasisPoints: 1600,
        taxCalculationMode: 'TAX_INCLUDED',
        stationId: barId,
        modifiers: [],
      }),
      'add-bar',
    );
    order.addItem(
      new ProductSnapshot({
        productId: EntityId.generate(),
        productName: 'Sin estación',
        basePrice: Money.fromMinorUnits(100, 'MXN'),
        taxRateBasisPoints: 1600,
        taxCalculationMode: 'TAX_INCLUDED',
        stationId: null,
        modifiers: [],
      }),
      'add-no-station',
    );
    const round = order.sendDraftItems('send-kds');
    new OrderRepository(handle.db).saveOrder(order, true, 'send-kds');
    const kds = new KdsRepository(handle.db);
    const kitchen = kds.listTickets(kitchenId.toString());
    const bar = kds.listTickets(barId.toString());
    expect(kitchen).toHaveLength(1);
    expect(bar).toHaveLength(1);
    expect(kitchen[0]!.items[0]).toMatchObject({
      productName: 'Hamburguesa snapshot',
      specialInstructions: 'solo una rodaja de tomate',
    });
    expect(kitchen[0]!.items[0]!.modifiers[0]!.name).toBe('Queso extra');
    const routedItems = [...kitchen, ...bar].flatMap((ticket) => ticket.items);
    expect(routedItems).toHaveLength(2);
    expect(routedItems.some((item) => item.productName === 'Sin estación')).toBe(false);
    expect(() =>
      kds.transitionTicket(round.id.toString(), kitchenId.toString(), 'READY', 'skip'),
    ).toThrow(KdsInvalidTransitionError);
    kds.transitionTicket(round.id.toString(), kitchenId.toString(), 'PREPARING', 'start');
    handle.close();

    const reopened = createEdgeDatabase(path);
    const persisted = new KdsRepository(reopened.db).listTickets(kitchenId.toString())[0]!;
    expect(persisted.status).toBe('PREPARING');
    expect(persisted.preparingAt).toBeInstanceOf(Date);
    new KdsRepository(reopened.db).transitionTicket(
      round.id.toString(),
      kitchenId.toString(),
      'READY',
      'ready',
    );
    expect(new KdsRepository(reopened.db).listTickets(kitchenId.toString())[0]!.status).toBe(
      'READY',
    );
    reopened.close();
  });
});
