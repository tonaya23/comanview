import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readModifierAdministration } from '@comanview/database';
import type { ModifierCommand, ErrorCode } from '@comanview/contracts';
import { AppError } from '../../../app/errorHandler.js';

const fail=(code:ErrorCode,status=409):never=>{throw new AppError(code,status,'No se modificó la configuración de opciones.');};
type Row={id:string;version:number;[key:string]:string|number|null};
/** Called only inside CatalogCommandService's authorized IMMEDIATE transaction. */
export function mutateModifier(db:Database.Database,command:ModifierCommand,binding:{tenantId:string;locationId:string}) {
  if(db.pragma('user_version',{simple:true})!==18)fail('CLIENT_CAPABILITY_REQUIRED');
  const load=(table:'modifier_groups'|'modifier_options',id:string)=>{
    const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row|undefined;
    if(!row)fail(table==='modifier_groups'?'MODIFIER_GROUP_NOT_FOUND':'MODIFIER_OPTION_NOT_FOUND',404);
    return row!;
  };
  const occ=(row:Row,expected:number)=>{if(row.version!==expected)fail('CATALOG_REFERENCE_CHANGED');};
  const change=(table:'modifier_groups'|'modifier_options',row:Row,values:Record<string,string|number>)=>{
    if(Object.entries(values).every(([key,value])=>row[key]===value))return false;
    if(row.version>=Number.MAX_SAFE_INTEGER)fail('CATALOG_REFERENCE_CHANGED');
    db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k=>`${k}=?`).join(',')},version=version+1 WHERE id=? AND version=?`).run(...Object.values(values),row.id,row.version);
    return true;
  };
  const money=(value:{amount:number;currency:string})=>{
    const config=db.prepare('SELECT currency FROM operational_configuration WHERE tenant_id=? AND location_id=?').get(binding.tenantId,binding.locationId) as {currency:string|null}|undefined;
    if(!config?.currency)fail('CURRENCY_REQUIRED');
    if(value.currency!==config!.currency)fail('CATALOG_CURRENCY_MISMATCH');
  };
  const before=readModifierAdministration(db);
  let groupId:string,changed=false,eventType:string;
  if(command.kind==='CREATE_MODIFIER_GROUP'){
    const p=command.payload;if(p.maxSelections<p.minSelections)fail('MODIFIER_CONFIGURATION_UNSATISFIABLE');
    groupId=randomUUID();
    db.prepare('INSERT INTO modifier_groups(id,name,min_selections,max_selections,active,version) VALUES(?,?,?,?,?,1)').run(groupId,p.name,p.minSelections,p.maxSelections,Number(p.active));
    changed=true;eventType='CATALOG_MODIFIER_GROUP_CREATED';
  }else if(command.kind==='UPDATE_MODIFIER_GROUP'||command.kind==='SET_MODIFIER_GROUP_ACTIVE'){
    const row=load('modifier_groups',command.entityId);occ(row,command.expectedVersion);groupId=row.id;
    if(command.kind==='UPDATE_MODIFIER_GROUP'){
      const p=command.payload;if(p.maxSelections<p.minSelections)fail('MODIFIER_CONFIGURATION_UNSATISFIABLE');
      changed=change('modifier_groups',row,{name:p.name,min_selections:p.minSelections,max_selections:p.maxSelections,active:Number(p.active)});
      eventType='CATALOG_MODIFIER_GROUP_UPDATED';
    }else{changed=change('modifier_groups',row,{active:Number(command.payload.active)});eventType='CATALOG_MODIFIER_GROUP_STATUS_CHANGED';}
  }else if(command.kind==='REORDER_MODIFIER_OPTIONS'){
    const group=load('modifier_groups',command.entityId);occ(group,command.expectedVersion);groupId=group.id;
    if(new Set(command.payload.options.map(o=>o.id)).size!==command.payload.options.length)fail('CATALOG_REFERENCE_CHANGED');
    for(const entry of command.payload.options){const row=load('modifier_options',entry.id);occ(row,entry.expectedVersion);
      if(row['group_id']!==groupId)fail('CATALOG_REFERENCE_CHANGED');changed=change('modifier_options',row,{display_order:entry.displayOrder})||changed;}
    if(changed){if(group.version>=Number.MAX_SAFE_INTEGER)fail('CATALOG_REFERENCE_CHANGED');db.prepare('UPDATE modifier_groups SET version=version+1 WHERE id=?').run(groupId);}
    eventType='CATALOG_MODIFIER_OPTIONS_REORDERED';
  }else{
    const group=load('modifier_groups',command.group.id);occ(group,command.group.version);groupId=group.id;
    if(command.kind==='CREATE_MODIFIER_OPTION'){
      const p=command.payload;money(p.unitPriceDelta);
      db.prepare('INSERT INTO modifier_options(id,group_id,name,price_delta_amount,price_delta_currency,active,available,display_order,version) VALUES(?,?,?,?,?,?,?,?,1)').run(randomUUID(),groupId,p.name,p.unitPriceDelta.amount,p.unitPriceDelta.currency,Number(p.active),Number(p.available),p.displayOrder);
      changed=true;eventType='CATALOG_MODIFIER_OPTION_CREATED';
    }else{
      const row=load('modifier_options',command.entityId);occ(row,command.expectedVersion);
      if(row['group_id']!==groupId)fail('CATALOG_REFERENCE_CHANGED');
      if(command.kind==='UPDATE_MODIFIER_OPTION'){
        const p=command.payload;money(p.unitPriceDelta);
        changed=change('modifier_options',row,{name:p.name,price_delta_amount:p.unitPriceDelta.amount,price_delta_currency:p.unitPriceDelta.currency,active:Number(p.active),available:Number(p.available),display_order:p.displayOrder});
        eventType='CATALOG_MODIFIER_OPTION_UPDATED';
      }else{
        changed=change('modifier_options',row,command.kind==='SET_MODIFIER_OPTION_ACTIVE'?{active:Number(command.payload.active)}:{available:Number(command.payload.available)});
        eventType='CATALOG_MODIFIER_OPTION_STATUS_CHANGED';
      }
    }
    if(changed){if(group.version>=Number.MAX_SAFE_INTEGER)fail('CATALOG_REFERENCE_CHANGED');db.prepare('UPDATE modifier_groups SET version=version+1 WHERE id=?').run(groupId);}
  }
  const result=readModifierAdministration(db).find(g=>g.id===groupId)!;
  // Unassigned groups can be assembled progressively. Active Products cannot be broken.
  if(result.products.some(p=>p.active)&&(!result.active||(result.minSelections>0&&!result.options.some(o=>o.active&&o.available))))
    fail(result.active?'MODIFIER_CONFIGURATION_UNSATISFIABLE':'MODIFIER_GROUP_IN_USE');
  return {group:result,before:before.find(g=>g.id===groupId)??null,changed,eventType};
}
