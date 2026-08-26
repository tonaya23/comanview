import { describe, expect, it, vi } from 'vitest';
import { createEdgeClient, EdgeClientError, type EdgeFetch, type EdgeResponse } from './index.js';

function jsonResponse(body: unknown, status = 200): EdgeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('createEdgeClient', () => {
  it('requests and validates the Edge health endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 'UP',
        edgeService: { status: 'OK', timestamp: '2026-08-25T12:00:00.000Z' },
        database: { status: 'OK' },
      }),
    );
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000/',
      fetch: fetchMock as EdgeFetch,
    });

    await expect(client.getHealth()).resolves.toMatchObject({ status: 'UP' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/health', expect.any(Object));
  });

  it('sends the current version when removing a DRAFT item', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: '01991a00-0000-7000-8000-000000000301',
        tenantId: '01991a00-0000-7000-8000-000000000302',
        locationId: '01991a00-0000-7000-8000-000000000303',
        orderType: 'COUNTER',
        channel: 'POS',
        currency: 'MXN',
        status: 'OPEN',
        tableIds: [],
        items: [],
        rounds: [],
        subtotal: { amount: 0, currency: 'MXN' },
        total: { amount: 0, currency: 'MXN' },
        paidAmount: { amount: 0, currency: 'MXN' },
        balanceDue: { amount: 0, currency: 'MXN' },
        tipTotal: { amount: 0, currency: 'MXN' },
        payments: [],
        version: 4,
        createdAt: '2026-08-25T12:00:00.000Z',
        updatedAt: '2026-08-25T12:00:00.000Z',
      }),
    );
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.removeOrderItem(
      '01991a00-0000-7000-8000-000000000301',
      '01991a00-0000-7000-8000-000000000304',
      { expectedVersion: 3 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/orders/01991a00-0000-7000-8000-000000000301/items/01991a00-0000-7000-8000-000000000304',
      expect.objectContaining({ method: 'DELETE', body: '{"expectedVersion":3}' }),
    );
  });

  it('sends a versioned idempotent special-instructions command', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      payments: [],
      version: 4,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    const request = {
      commandId: 'note-command',
      expectedVersion: 3,
      specialInstructions: 'salsa aparte',
    };

    await client.updateOrderItemSpecialInstructions(
      order.id,
      '01991a00-0000-7000-8000-000000000304',
      request,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/items/01991a00-0000-7000-8000-000000000304/instructions`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(request) }),
    );
  });

  it('sends an authoritative DRAFT configuration edit command', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      payments: [],
      version: 5,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    const request = {
      commandId: 'configuration-command',
      expectedVersion: 4,
      selectedModifierIds: ['01991a00-0000-7000-8000-000000000401'],
      specialInstructions: 'sin cebolla',
    };

    await client.updateDraftOrderItemConfiguration(
      order.id,
      '01991a00-0000-7000-8000-000000000304',
      request,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/items/01991a00-0000-7000-8000-000000000304/configuration`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(request) }),
    );
  });

  it('exposes stable Edge error codes', async () => {
    const client = createEdgeClient({
      fetch: vi.fn(async () =>
        jsonResponse({ error: 'STALE_ORDER_VERSION', message: 'Order changed' }, 409),
      ) as EdgeFetch,
    });

    await expect(client.getOrder('order-id')).rejects.toMatchObject({
      code: 'STALE_ORDER_VERSION',
      status: 409,
    } satisfies Partial<EdgeClientError>);
  });

  it('sends exact payment intent without deriving financial values', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      payments: [],
      version: 2,
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.createPayment(order.id, {
      commandId: 'payment-command',
      expectedVersion: 1,
      method: 'CASH',
      amountApplied: 105,
      tip: { type: 'PERCENTAGE', basisPoints: 1000 },
      cashTendered: 120,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/payments`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          commandId: 'payment-command',
          expectedVersion: 1,
          method: 'CASH',
          amountApplied: 105,
          tip: { type: 'PERCENTAGE', basisPoints: 1000 },
          cashTendered: 120,
        }),
      }),
    );
  });
});
