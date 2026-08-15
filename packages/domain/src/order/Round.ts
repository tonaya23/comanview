import { EntityId } from '../shared/EntityId.js';

export interface RoundProps {
  id: EntityId;
  /** Monotonically incrementing round number within this Order (1-based). */
  roundNumber: number;
  sentAt: Date;
}

/**
 * A Round groups all items that were sent to the kitchen/bar together in one batch.
 * Every SENT OrderItem belongs to exactly one Round (INV-06).
 */
export class Round {
  constructor(private readonly props: RoundProps) {}

  get id(): EntityId { return this.props.id; }
  get roundNumber(): number { return this.props.roundNumber; }
  get sentAt(): Date { return this.props.sentAt; }
}
