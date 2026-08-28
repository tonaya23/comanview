import { describe, expect, it } from 'vitest';
import type { ClaimedCloudEvent } from '@comanview/database';
import { toProjectionAction } from './eventPayloads.js';

function claimed(overrides: Partial<ClaimedCloudEvent> = {}): ClaimedCloudEvent {
  return {
    eventId: '01991a00-0000-7000-8000-000000000901',
    schemaVersion: 1,
    eventType: 'PAYMENT_COMPLETED',
    aggregateType: 'ORDER',
    aggregateId: '01991a00-0000-7000-8000-000000000902',
    aggregateVersion: 2,
    tenantId: '01991a00-0000-7000-8000-000000000301',
    locationId: '01991a00-0000-7000-8000-000000000302',
    edgeId: '01991a00-0000-7000-8000-000000000903',
    localSequence: 2,
    payload: {
      paymentId: '01991a00-0000-7000-8000-000000000904',
      cashSessionId: '01991a00-0000-7000-8000-000000000905',
      method: 'CASH',
      amountApplied: 12_900,
      tipAmount: 500,
      currency: 'MXN',
    },
    occurredAt: new Date('2026-08-27T12:00:00.000Z'),
    processingAttemptCount: 1,
    ...overrides,
  };
}

describe('Cloud projection event payload validation', () => {
  it('keeps sale amount and tip separate in a Payment action', () => {
    expect(toProjectionAction(claimed())).toEqual({
      type: 'PAYMENT_COMPLETED',
      paymentId: '01991a00-0000-7000-8000-000000000904',
      cashSessionId: '01991a00-0000-7000-8000-000000000905',
      method: 'CASH',
      amountApplied: 12_900,
      tipAmount: 500,
      currency: 'MXN',
    });
  });

  it('returns null for an unknown event type', () => {
    expect(toProjectionAction(claimed({ eventType: 'FUTURE_EVENT', payload: {} }))).toBeNull();
  });

  it('rejects a malformed known payload and an unsupported schema version', () => {
    expect(() =>
      toProjectionAction(claimed({ eventType: 'ORDER_CREATED', payload: {} })),
    ).toThrow();
    expect(() => toProjectionAction(claimed({ schemaVersion: 2 }))).toThrow(
      'Unsupported event schema version 2',
    );
  });

  it('rejects inconsistent currencies in a Cash closure', () => {
    expect(() =>
      toProjectionAction(
        claimed({
          eventType: 'CASH_SESSION_CLOSED',
          payload: {
            cashSessionId: '01991a00-0000-7000-8000-000000000906',
            businessDate: '2026-08-27',
            expectedCash: { amount: 100, currency: 'MXN' },
            countedCash: { amount: 100, currency: 'USD' },
            difference: { amount: 0, currency: 'MXN' },
            closedBy: '01991a00-0000-7000-8000-000000000907',
          },
        }),
      ),
    ).toThrow('Cash closure currencies do not match');
  });
});
