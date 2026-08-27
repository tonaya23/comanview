import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RealtimeHub } from './RealtimeHub.js';

class TestSocket extends EventEmitter {
  readonly readyState = 1;
  readonly messages: string[] = [];
  send(data: string) {
    this.messages.push(data);
  }
  close() {
    this.emit('close');
  }
}

describe('RealtimeHub location boundary', () => {
  it('publishes operational invalidations only inside their Location', () => {
    const hub = new RealtimeHub();
    const local = new TestSocket();
    const other = new TestSocket();
    const locationId = '01991a00-0000-7000-8000-000000000302';
    hub.subscribe(local, locationId);
    hub.subscribe(other, '01991a00-0000-7000-8000-000000000399');

    hub.publish({
      type: 'ORDER_UPDATED',
      locationId,
      orderId: '01991a00-0000-7000-8000-000000000901',
      version: 2,
      reason: 'ITEM_ADDED',
      occurredAt: '2026-08-27T12:00:00.000Z',
    });

    expect(local.messages).toHaveLength(1);
    expect(other.messages).toHaveLength(0);
  });
});
