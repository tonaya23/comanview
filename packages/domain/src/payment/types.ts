export type PaymentMethod = 'CASH' | 'CARD' | 'OTHER';

export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'VOIDED';

export type TipSelection =
  | { type: 'NONE' }
  | { type: 'FIXED_AMOUNT'; amount: number }
  | { type: 'PERCENTAGE'; basisPoints: number }
  | { type: 'REMAINDER' };
