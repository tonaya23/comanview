import type Database from 'better-sqlite3';
import { CommercialModifierGroupSchema, type CommercialModifierGroup, type CommercialModifierOption } from '@comanview/contracts';

/** Three bounded set reads; no per-Product/Group queries. */
export function readModifierAdministration(db:Database.Database):CommercialModifierGroup[] {
  const groups=db.prepare('SELECT id,name,min_selections minSelections,max_selections maxSelections,active,version FROM modifier_groups ORDER BY name,id').all() as Array<{id:string;name:string;minSelections:number;maxSelections:number;active:number;version:number}>;
  const options=db.prepare('SELECT id,group_id groupId,name,price_delta_amount amount,price_delta_currency currency,active,available,display_order displayOrder,version FROM modifier_options ORDER BY display_order,id').all() as Array<{id:string;groupId:string;name:string;amount:number;currency:string;active:number;available:number;displayOrder:number;version:number}>;
  const products=db.prepare('SELECT pmg.modifier_group_id groupId,p.id,p.name,p.active FROM product_modifier_groups pmg JOIN products p ON p.id=pmg.product_id ORDER BY p.name,p.id').all() as Array<{groupId:string;id:string;name:string;active:number}>;
  const byGroup=new Map<string,CommercialModifierOption[]>(), usage=new Map<string,Array<{id:string;name:string;active:boolean}>>();
  for(const o of options)byGroup.set(o.groupId,[...(byGroup.get(o.groupId)??[]),{id:o.id,groupId:o.groupId,name:o.name,version:o.version,displayOrder:o.displayOrder,active:Boolean(o.active),available:Boolean(o.available),unitPriceDelta:{amount:o.amount,currency:o.currency}}]);
  for(const p of products)usage.set(p.groupId,[...(usage.get(p.groupId)??[]),{id:p.id,name:p.name,active:Boolean(p.active)}]);
  return groups.map(g=>CommercialModifierGroupSchema.parse({...g,active:Boolean(g.active),options:byGroup.get(g.id)??[],products:usage.get(g.id)??[]}));
}
