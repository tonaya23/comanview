import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeHub,REALTIME_QUEUE_LIMIT } from './RealtimeHub.js';

class TestSocket extends EventEmitter {
  readonly readyState = 1;
  readonly messages: string[] = [];
  code:number|undefined;
  send(data: string) {
    this.messages.push(data);
  }
  close(code?:number) {
    this.code=code;
    this.emit('close');
  }
}

describe('RealtimeHub location boundary', () => {
  it('delivers catalog invalidation only after authorization and only to its location',async()=>{
    const hub=new RealtimeHub(),local=new TestSocket(),other=new TestSocket();
    let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});
    hub.subscribe(local,'local',async deliver=>{await pending;deliver();return 'AUTHORIZED';});hub.subscribe(other,'other');
    hub.publish({type:'CATALOG_CHANGED',locationId:'local',recoveryEpoch:8,catalogGeneration:3,capabilityVersion:1,affectedTypes:['PRODUCT'],affectedIds:[],fullInvalidation:true});
    expect(local.messages).toEqual([]);release();await vi.waitFor(()=>expect(local.messages).toHaveLength(1));expect(other.messages).toEqual([]);
  });
  const event=(version:number)=>({type:'ORDER_UPDATED' as const,locationId:'local',orderId:'order',version,reason:'ITEM_ADDED' as const,occurredAt:'2026-09-15T00:00:00Z'});
  it('holds delivery during authorization, preserves order and coalesces concurrent revalidation',async()=>{
    const hub=new RealtimeHub(),socket=new TestSocket();
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const authorize=vi.fn(async(deliver:()=>void)=>{await gate;deliver();return 'AUTHORIZED' as const;});
    const revalidate=hub.subscribe(socket,'local',authorize);
    for(let n=1;n<=20;n++){hub.publish(event(n));revalidate();}
    expect(socket.messages).toHaveLength(0);expect(authorize).toHaveBeenCalledTimes(1);
    release();await vi.waitFor(()=>expect(socket.messages).toHaveLength(20));
    expect(socket.messages.map(value=>JSON.parse(value).version)).toEqual(Array.from({length:20},(_,n)=>n+1));
    expect(socket.code).toBeUndefined();
  });
  it.each(['TEMPORARILY_UNAVAILABLE','INVALID'] as const)('does not deliver when authorization is %s',async result=>{
    const hub=new RealtimeHub(),socket=new TestSocket();hub.subscribe(socket,'local',async()=>result);
    hub.publish(event(1));await vi.waitFor(()=>expect(socket.code).toBe(result==='INVALID'?1008:1013));
    expect(socket.messages).toHaveLength(0);
  });
  it('bounds a stalled subscriber and never sends its queued events after closure',async()=>{
    const hub=new RealtimeHub(),socket=new TestSocket();let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    hub.subscribe(socket,'local',async deliver=>{await gate;deliver();return 'AUTHORIZED';});
    for(let n=0;n<=REALTIME_QUEUE_LIMIT;n++)hub.publish(event(n));
    expect(socket.code).toBe(1013);release();await Promise.resolve();await Promise.resolve();
    expect(socket.messages).toHaveLength(0);
  });
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
