import type { OperationalRealtimeMessage } from '@comanview/contracts';

interface RealtimeSocket {
  readonly readyState: number;
  readonly bufferedAmount?:number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

export type RealtimeAuthorization=(deliver:()=>void)=>Promise<'AUTHORIZED'|'TEMPORARILY_UNAVAILABLE'|'INVALID'>;
interface RealtimeSubscriber {
  socket: RealtimeSocket;
  locationId: string;
  authorize: RealtimeAuthorization;
  queue:string[];
  running:boolean;
  closed:boolean;
  deadline:ReturnType<typeof setTimeout>|null;
}

const OPEN = 1;
export const REALTIME_QUEUE_LIMIT=64;

export class RealtimeHub {
  private readonly subscribers = new Set<RealtimeSubscriber>();

  subscribe(
    socket: RealtimeSocket,
    locationId: string,
    authorize: RealtimeAuthorization = async deliver => {deliver();return 'AUTHORIZED';},
  ): () => void {
    const subscriber:RealtimeSubscriber = { socket, locationId, authorize,queue:[],running:false,closed:false,deadline:null };
    this.subscribers.add(subscriber);
    const remove = () => {subscriber.closed=true;subscriber.queue.length=0;this.subscribers.delete(subscriber);if(subscriber.deadline)clearTimeout(subscriber.deadline);};
    socket.on('close', remove);
    socket.on('error', remove);
    return ()=>{if(!subscriber.running&&!subscriber.closed)void this.drain(subscriber);};
  }

  private close(s:RealtimeSubscriber,code:number,reason:string){
    s.closed=true;s.queue.length=0;this.subscribers.delete(s);
    if(s.deadline)clearTimeout(s.deadline);
    s.socket.close(code,reason);
  }
  private async drain(s:RealtimeSubscriber){
    if(s.running||s.closed)return;
    s.running=true;
    s.deadline=setTimeout(()=>this.close(s,1013,'SECURITY_VALIDATION_PENDING'),5000);
    s.deadline.unref?.();
    try {
      do {
        const message=s.queue[0];
        const result=await s.authorize(()=>{
          if(s.closed||s.socket.readyState!==OPEN)return;
          if((s.socket.bufferedAmount??0)>256*1024){this.close(s,1013,'REALTIME_BACKPRESSURE');return;}
          if(message!==undefined)s.socket.send(message);
        });
        if(s.closed)return;
        if(result!=='AUTHORIZED'){
          this.close(s,result==='INVALID'?1008:1013,result==='INVALID'?'AUTH_SESSION_INVALID':'SECURITY_VALIDATION_PENDING');return;
        }
        if(message!==undefined)s.queue.shift();
      }while(s.queue.length&&!s.closed);
    }catch{this.close(s,1013,'REALTIME_UNAVAILABLE');}
    finally{s.running=false;if(s.deadline)clearTimeout(s.deadline);s.deadline=null;}
  }

  publish(message: OperationalRealtimeMessage): void {
    const serialized = JSON.stringify(message);
    for (const subscriber of this.subscribers) {
      const { socket, locationId } = subscriber;
      if (socket.readyState !== OPEN) {
        this.subscribers.delete(subscriber);
        continue;
      }
      if (message.locationId !== locationId) continue;
      if(subscriber.queue.length>=REALTIME_QUEUE_LIMIT){this.close(subscriber,1013,'REALTIME_BACKPRESSURE');continue;}
      subscriber.queue.push(serialized);void this.drain(subscriber);
    }
  }
}
