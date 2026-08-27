import { DomainError } from '../shared/DomainError.js';
import type { OrderItemPrepStatus } from './types.js';

export type KdsTransitionTarget = Exclude<OrderItemPrepStatus, 'PENDING'>;

export class KdsInvalidTransitionError extends DomainError {
  constructor(current: OrderItemPrepStatus, target: KdsTransitionTarget) {
    super(
      `KDS preparation cannot transition from ${current} to ${target}.`,
      'KDS_INVALID_TRANSITION',
    );
  }
}

export class KdsInconsistentTicketStateError extends DomainError {
  constructor() {
    super(
      'Items in one KDS ticket do not share the same preparation state.',
      'KDS_INCONSISTENT_STATE',
    );
  }
}

export function resolveKdsTransition(
  statuses: ReadonlyArray<OrderItemPrepStatus>,
  target: KdsTransitionTarget,
): 'APPLY' | 'NOOP' {
  const currentStates = new Set(statuses);
  if (currentStates.size !== 1) throw new KdsInconsistentTicketStateError();
  const current = statuses[0];
  if (!current) throw new KdsInconsistentTicketStateError();
  if (current === target) return 'NOOP';
  if (current === 'PENDING' && target === 'PREPARING') return 'APPLY';
  if (current === 'PREPARING' && target === 'READY') return 'APPLY';
  throw new KdsInvalidTransitionError(current, target);
}
