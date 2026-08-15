export type OrderStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export type OrderItemSendStatus = 'DRAFT' | 'SENT';

/**
 * prep_status tracks kitchen preparation state for a SENT item.
 * PENDING = waiting to be picked up by the station.
 * PREPARING = kitchen has started.
 * READY = ready to be served.
 */
export type OrderItemPrepStatus = 'PENDING' | 'PREPARING' | 'READY';

export type OrderType = 'COUNTER' | 'TABLE' | 'TAKEOUT';

export type OrderChannel = 'POS' | 'WAITER';
