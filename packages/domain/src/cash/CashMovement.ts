import { Money } from '@comanview/money';
import { EntityId } from '../shared/EntityId.js';
import { InvalidCashMovementError } from './errors.js';

export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export interface CashMovementProps {
  id: EntityId;
  cashSessionId: EntityId;
  type: CashMovementType;
  amount: Money;
  reason: string;
  actorUserId: EntityId;
  occurredAt: Date;
  commandId: string;
}

export class CashMovement {
  private constructor(private readonly props: CashMovementProps) {}

  static create(input: Omit<CashMovementProps, 'id' | 'reason' | 'occurredAt'> & {
    reason: string;
    occurredAt?: Date;
  }): CashMovement {
    const reason = input.reason.trim();
    if (!input.amount.isPositive()) {
      throw new InvalidCashMovementError('CashMovement amount must be greater than zero.');
    }
    if (!reason || reason.length > 240) {
      throw new InvalidCashMovementError('CashMovement reason must contain 1 to 240 characters.');
    }
    return new CashMovement({
      ...input,
      id: EntityId.generate(),
      reason,
      occurredAt: input.occurredAt ?? new Date(),
    });
  }

  static rehydrate(props: CashMovementProps): CashMovement {
    return new CashMovement(props);
  }

  get id(): EntityId { return this.props.id; }
  get cashSessionId(): EntityId { return this.props.cashSessionId; }
  get type(): CashMovementType { return this.props.type; }
  get amount(): Money { return this.props.amount; }
  get reason(): string { return this.props.reason; }
  get actorUserId(): EntityId { return this.props.actorUserId; }
  get occurredAt(): Date { return this.props.occurredAt; }
  get commandId(): string { return this.props.commandId; }
}
