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
  it('keeps PIN login unauthenticated and sends the opaque session token afterwards', async () => {
    let token: string | null = null;
    const fetchMock = vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
      if (input.endsWith('/auth/login')) {
        return jsonResponse({
          token: 'opaque-local-session-token-with-sufficient-length',
          user: {
            id: '01991a00-0000-7000-8000-000000000712',
            displayName: 'Cajero desarrollo',
            status: 'ACTIVE',
            roles: ['CASHIER'],
            permissions: ['ORDER_CREATE'],
          },
          session: {
            id: '01991a00-0000-7000-8000-000000000799',
            deviceId: '01991a00-0000-7000-8000-000000000721',
            loginAt: '2026-08-27T12:00:00.000Z',
            lastActivity: '2026-08-27T12:00:00.000Z',
            expiresAt: '2026-08-28T00:00:00.000Z',
          },
        });
      }
      expect(init?.headers?.['authorization']).toBe(`Bearer ${token}`);
      return jsonResponse({
        user: {
          id: '01991a00-0000-7000-8000-000000000712',
          displayName: 'Cajero desarrollo',
          status: 'ACTIVE',
          roles: ['CASHIER'],
          permissions: ['ORDER_CREATE'],
        },
        session: {
          id: '01991a00-0000-7000-8000-000000000799',
          deviceId: '01991a00-0000-7000-8000-000000000721',
          loginAt: '2026-08-27T12:00:00.000Z',
          lastActivity: '2026-08-27T12:00:00.000Z',
          expiresAt: '2026-08-28T00:00:00.000Z',
        },
      });
    });
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000',
      fetch: fetchMock as EdgeFetch,
      getAccessToken: () => token,
    });

    const loggedIn = await client.login({
      pin: '2222',
      deviceId: '01991a00-0000-7000-8000-000000000721',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    token = loggedIn.token;
    await client.getCurrentSession();
  });

  it('preserves the current Bearer token when adding JSON content headers', async () => {
    const token = 'current-local-session-token';
    const fetchMock = vi.fn(async (_input: string, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers).toEqual({
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      });
      return jsonResponse(
        {
          id: '01991a00-0000-7000-8000-000000000731',
          cashRegisterId: '01991a00-0000-7000-8000-000000000601',
          status: 'OPEN',
          purpose: 'NORMAL',
          openingFloat: { amount: 1000, currency: 'MXN' },
          expectedCash: { amount: 1000, currency: 'MXN' },
          blindCashCount: false,
          businessDate: '2026-08-27',
          openedAt: '2026-08-27T12:00:00.000Z',
          openedBy: '01991a00-0000-7000-8000-000000000712',
          closedAt: null,
          closedBy: null,
          countedCash: null,
          expectedCashAtClose: null,
          difference: null,
        },
        201,
      );
    });
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000',
      fetch: fetchMock as EdgeFetch,
      getAccessToken: () => token,
    });

    await client.openCashSession({
      commandId: 'sdk-auth-open-cash',
      openingFloatAmount: 1000,
      businessDate: '2026-08-27',
    });
  });

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

  it('sends the reason and one-operation override PIN only in the void request body', async () => {
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
      version: 3,
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
    const request = {
      commandId: 'void-command',
      expectedVersion: 2,
      reason: 'Cobro duplicado',
      overridePin: '5555',
    };

    await client.voidPayment(order.id, '01991a00-0000-7000-8000-000000000701', request);

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/payments/01991a00-0000-7000-8000-000000000701/void`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    );
  });

  it('queries the durable audit log with typed filters', async () => {
    const response = { entries: [] };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.getAuditEntries({
      action: 'PAYMENT_VOIDED',
      actorUserId: '01991a00-0000-7000-8000-000000000801',
      resourceId: '01991a00-0000-7000-8000-000000000802',
      from: '2026-08-27T12:00:00.000Z',
      to: '2026-08-27T13:00:00.000Z',
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/audit?action=PAYMENT_VOIDED&actorUserId=01991a00-0000-7000-8000-000000000801&resourceId=01991a00-0000-7000-8000-000000000802&from=2026-08-27T12%3A00%3A00.000Z&to=2026-08-27T13%3A00%3A00.000Z&limit=25',
      {},
    );
  });

  it('requests durable print jobs with an idempotency command', async () => {
    const job = {
      printJobId: '01991a00-0000-7000-8000-000000000901',
      orderId: '01991a00-0000-7000-8000-000000000301',
      cashSessionId: null,
      roundId: null,
      stationId: null,
      targetId: '01991a00-0000-7000-8000-000000000902',
      jobType: 'PRECHECK',
      status: 'PENDING',
      attempts: 0,
      createdAt: '2026-08-26T12:00:00.000Z',
      updatedAt: '2026-08-26T12:00:00.000Z',
      lastError: null,
    };
    const fetchMock = vi.fn(async () => jsonResponse(job, 201));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    await client.requestPrecheck(job.orderId, { commandId: 'print-command' });
    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${job.orderId}/precheck`,
      expect.objectContaining({ method: 'POST', body: '{"commandId":"print-command"}' }),
    );
  });

  it('queries and advances KDS tickets through Edge', async () => {
    const ticket = {
      ticketId: 'round:station',
      orderId: '01991a00-0000-7000-8000-000000000301',
      orderNumber: 'K-1',
      orderType: 'COUNTER',
      roundId: '01991a00-0000-7000-8000-000000000302',
      roundNumber: 1,
      stationId: '01991a00-0000-7000-8000-000000000501',
      stationName: 'COCINA',
      status: 'PREPARING',
      sentAt: '2026-08-26T12:00:00.000Z',
      preparingAt: '2026-08-26T12:01:00.000Z',
      readyAt: null,
      items: [
        {
          orderItemId: '01991a00-0000-7000-8000-000000000601',
          quantity: 1,
          productName: 'Hamburguesa',
          modifiers: [],
          specialInstructions: null,
          prepStatus: 'PREPARING',
        },
      ],
    };
    const fetchMock = vi.fn(async () => jsonResponse(ticket));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    await client.startKdsTicket(ticket.roundId, ticket.stationId, { commandId: 'start-kds' });
    expect(fetchMock).toHaveBeenCalledWith(
      `/kds/tickets/${ticket.roundId}/${ticket.stationId}/preparing`,
      expect.objectContaining({ method: 'POST', body: '{"commandId":"start-kds"}' }),
    );
  });

  it('lists tables and sends an explicit idempotent table move command', async () => {
    const table = {
      id: '01991a00-0000-7000-8000-000000000801',
      locationId: '01991a00-0000-7000-8000-000000000302',
      name: 'Mesa 1',
      zone: 'SALÓN',
      capacity: 4,
      displayOrder: 10,
      active: true,
      status: 'FREE',
      activeOrderId: null,
      activeOrderNumber: null,
    };
    const order = {
      id: '01991a00-0000-7000-8000-000000000901',
      tenantId: '01991a00-0000-7000-8000-000000000301',
      locationId: table.locationId,
      orderType: 'TABLE',
      channel: 'WAITER',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [table.id],
      items: [],
      rounds: [],
      payments: [],
      version: 2,
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      createdAt: '2026-08-27T12:00:00.000Z',
      updatedAt: '2026-08-27T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse(url === '/tables' ? [table] : order),
    );
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    expect(await client.getTables()).toMatchObject([table]);
    const move = { commandId: 'move-order', expectedVersion: 1, tableIds: [table.id] };
    await client.updateOrderTables(order.id, move);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/tables`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(move) }),
    );
    const cancellation = { commandId: 'cancel-empty-table', expectedVersion: order.version };
    await client.cancelEmptyTableOrder(order.id, cancellation);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/cancel-empty`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(cancellation) }),
    );
    const requestPayment = { commandId: 'request-payment', expectedVersion: order.version };
    await client.requestOrderPayment(order.id, requestPayment);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/payment-request`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(requestPayment) }),
    );
  });
});
