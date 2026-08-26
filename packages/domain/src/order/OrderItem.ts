import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ProductSnapshot } from '../catalog/Snapshot.js';
import { OrderItemSendStatus, OrderItemPrepStatus } from './types.js';

/**
 * Read-only view of an OrderItem exposed outside the Order Aggregate.
 * Consumers can read state but cannot invoke internal mutators.
 */
export interface OrderItemView {
  readonly id: EntityId;
  readonly snapshot: ProductSnapshot;
  readonly quantity: number;
  readonly sendStatus: OrderItemSendStatus;
  readonly prepStatus: OrderItemPrepStatus;
  readonly roundId: EntityId | null;
  readonly specialInstructions: string | null;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  getLineTotal(): Money;
}

export interface OrderItemProps {
  id: EntityId;
  snapshot: ProductSnapshot;
  quantity: number;
  sendStatus: OrderItemSendStatus;
  prepStatus: OrderItemPrepStatus;
  /** Set when the item is sent as part of a Round (INV-06). */
  roundId: EntityId | null;
  /** Transactional preparation note; intentionally separate from ProductSnapshot. */
  specialInstructions: string | null;
}

export const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 500;

export function normalizeSpecialInstructions(value?: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

/**
 * OrderItem is an internal entity of the Order Aggregate Root.
 *
 * AGGREGATE BOUNDARY: This class is NOT exported from the `order` module public API.
 * External consumers see only the `OrderItemView` interface.
 * Internal mutation methods (_markAsSent, _updatePrepStatus) are intentionally
 * prefixed with `_` to signal they belong to the Aggregate's internal protocol.
 */
export class OrderItem implements OrderItemView {
  constructor(private props: OrderItemProps) {}

  get id(): EntityId {
    return this.props.id;
  }
  get snapshot(): ProductSnapshot {
    return this.props.snapshot;
  }
  get quantity(): number {
    return this.props.quantity;
  }
  get sendStatus(): OrderItemSendStatus {
    return this.props.sendStatus;
  }
  get prepStatus(): OrderItemPrepStatus {
    return this.props.prepStatus;
  }
  get roundId(): EntityId | null {
    return this.props.roundId;
  }
  get specialInstructions(): string | null {
    return this.props.specialInstructions;
  }
  get isDraft(): boolean {
    return this.props.sendStatus === 'DRAFT';
  }
  get isSent(): boolean {
    return this.props.sendStatus === 'SENT';
  }

  /**
   * Calculate the line total: (base price + all modifier deltas) × quantity.
   * All arithmetic is exact using @comanview/money.
   */
  getLineTotal(): Money {
    const snapshot = this.props.snapshot;
    const currency = snapshot.basePrice.currency;

    const modifierTotal = snapshot.modifiers.reduce(
      (acc, mod) => acc.add(mod.priceDelta),
      Money.zero(currency),
    );

    const unitPrice = snapshot.basePrice.add(modifierTotal);
    return unitPrice.multiply(this.props.quantity);
  }

  /** Internal: called by Order.sendDraftItems() only. */
  _markAsSent(roundId: EntityId): void {
    this.props.sendStatus = 'SENT';
    this.props.prepStatus = 'PENDING';
    this.props.roundId = roundId;
  }

  /** Internal: called by Order.updateItemSpecialInstructions() only. */
  _setSpecialInstructions(value: string | null): void {
    this.props.specialInstructions = value;
  }

  /** Internal: to be called by KDS integration at application layer. */
  _updatePrepStatus(status: OrderItemPrepStatus): void {
    this.props.prepStatus = status;
  }
}
