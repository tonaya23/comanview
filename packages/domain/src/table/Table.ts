import { EntityId } from '../shared/EntityId.js';
import { DomainError } from '../shared/DomainError.js';

export interface RestaurantTableProps {
  id: EntityId;
  tenantId: EntityId;
  locationId: EntityId;
  name: string;
  zone: string | null;
  capacity: number | null;
  displayOrder: number;
  active: boolean;
}

export type TableOperationalStatus = 'FREE' | 'OPEN' | 'READY' | 'PAYMENT_REQUESTED';

export interface TableOperationalSignals {
  hasActiveOrder: boolean;
  hasReadyItems: boolean;
  paymentRequested: boolean;
}

/** Central V1 precedence: payment attention outranks ready food, then an ordinary open table. */
export function deriveTableOperationalStatus(
  signals: TableOperationalSignals,
): TableOperationalStatus {
  if (!signals.hasActiveOrder) return 'FREE';
  if (signals.paymentRequested) return 'PAYMENT_REQUESTED';
  if (signals.hasReadyItems) return 'READY';
  return 'OPEN';
}

export class InvalidRestaurantTableError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_RESTAURANT_TABLE');
  }
}

/** Physical restaurant resource. Occupancy is deliberately derived outside this entity. */
export class RestaurantTable {
  private constructor(private readonly props: RestaurantTableProps) {}

  static rehydrate(props: RestaurantTableProps): RestaurantTable {
    if (!props.name.trim()) throw new InvalidRestaurantTableError('Table name is required.');
    if (props.capacity !== null && (!Number.isInteger(props.capacity) || props.capacity <= 0)) {
      throw new InvalidRestaurantTableError('Table capacity must be a positive integer.');
    }
    return new RestaurantTable({ ...props, name: props.name.trim(), zone: props.zone?.trim() || null });
  }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get locationId() { return this.props.locationId; }
  get name() { return this.props.name; }
  get zone() { return this.props.zone; }
  get capacity() { return this.props.capacity; }
  get displayOrder() { return this.props.displayOrder; }
  get active() { return this.props.active; }
}
