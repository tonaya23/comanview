import type { EdgeClient } from '@comanview/client-sdk';
import type { OrderResponse } from '@comanview/contracts';

export function isDiscardableCounterSale(order: OrderResponse): boolean {
  return order.orderType==='COUNTER' && order.status==='OPEN' && order.items.length===0 && order.rounds.length===0 && order.payments.length===0;
}
export async function openCurrentCounterSale(edge: Pick<EdgeClient,'getOrder'>, id: string) {
  const order=await edge.getOrder(id);
  if(order.orderType!=='COUNTER'||order.status!=='OPEN')throw new Error('Esta venta ya no está abierta. Actualiza la lista.');
  return order;
}
export async function discardCounterSale(edge: Pick<EdgeClient,'cancelOrder'|'getOpenCounterOrders'>, order: OrderResponse,
  confirmed: (order: OrderResponse)=>void) {
  if(!isDiscardableCounterSale(order))throw new Error('Solo puedes descartar una venta de mostrador abierta sin productos, rondas ni pagos.');
  const cancelled=await edge.cancelOrder(order.id,{expectedVersion:order.version,emptyCounterOnly:true});
  confirmed(cancelled);
  try{return {remaining:await edge.getOpenCounterOrders(),refreshFailed:false};}
  catch{return {remaining:null,refreshFailed:true};}
}
