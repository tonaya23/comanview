import { describe, expect, it } from 'vitest';
import {
  KdsInconsistentTicketStateError,
  KdsInvalidTransitionError,
  resolveKdsTransition,
} from '../KdsPreparation.js';

describe('KDS preparation transitions', () => {
  it('allows only PENDING → PREPARING → READY', () => {
    expect(resolveKdsTransition(['PENDING'], 'PREPARING')).toBe('APPLY');
    expect(resolveKdsTransition(['PREPARING'], 'READY')).toBe('APPLY');
    expect(resolveKdsTransition(['READY'], 'READY')).toBe('NOOP');
  });

  it('rejects skips, regressions, and inconsistent station slices', () => {
    expect(() => resolveKdsTransition(['PENDING'], 'READY')).toThrow(KdsInvalidTransitionError);
    expect(() => resolveKdsTransition(['READY'], 'PREPARING')).toThrow(KdsInvalidTransitionError);
    expect(() => resolveKdsTransition(['PENDING', 'PREPARING'], 'PREPARING')).toThrow(
      KdsInconsistentTicketStateError,
    );
  });
});
