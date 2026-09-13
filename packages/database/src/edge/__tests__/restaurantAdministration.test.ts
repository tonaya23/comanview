import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync,readdirSync } from 'node:fs';import { fileURLToPath } from 'node:url';import { join } from 'node:path';
import { describe,expect,it } from 'vitest';import { EntityId } from '@comanview/domain';import type { RestaurantAdministrationCommand } from '@comanview/contracts';
import * as schema from '../schema.js';import { initializeLegacyAdministrationBaseline,RestaurantAdministrationRepository } from '../repositories/RestaurantAdministrationRepository.js';
import type { NewAuditEntry } from '../repositories/AuditRepository.js';
const directory=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url)),id=()=>EntityId.generate().toString();
function fixture(){const sqlite=new Database(':memory:');for(const name of readdirSync(directory).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=15).sort())sqlite.exec(readFileSync(join(directory,name),'utf8'));
  const binding={tenantId:id(),locationId:id(),edgeId:id()};sqlite.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)").run(binding.edgeId,binding.tenantId,binding.locationId);
  initializeLegacyAdministrationBaseline(sqlite,binding);const repo=new RestaurantAdministrationRepository(drizzle(sqlite,{schema}));
  const audit=(commandId:string):NewAuditEntry=>({auditId:id(),occurredAt:new Date(),tenantId:binding.tenantId,locationId:binding.locationId,deviceId:id(),sessionId:id(),actorUserId:id(),actorRole:'OWNER',
    authorizedByUserId:null,authorizedByRole:null,action:'RESTAURANT_ADMINISTRATION_CHANGED',entityType:'OPERATIONAL_CONFIGURATION',entityId:binding.locationId,outcome:'SUCCESS',reason:'Configure restaurant',commandId,
    before:null,after:null,amountAffected:null,currency:null,eventId:null});
  const run=(c:RestaurantAdministrationCommand)=>repo.execute(c,binding,audit(c.commandId));return{sqlite,binding,repo,run};}
describe('restaurant administration persistence',()=>{
  it('persists profile with OCC and exactly one audit/outbox receipt on retry',()=>{const f=fixture();try{const c:RestaurantAdministrationCommand={kind:'UPDATE_BUSINESS_PROFILE',commandId:id(),expectedVersion:1,reason:'Confirm business profile',
      commercialName:'Casa',legalName:null,phone:null,email:null,address:{line1:'',line2:'',city:'',region:'',postalCode:'',countryCode:null},operatingHours:[],logo:null,confirmed:true};
    const first=f.run(c);expect(f.run(c)).toEqual(first);expect(f.repo.state(f.binding).businessProfile.commercialName).toBe('Casa');
    expect(f.sqlite.prepare("SELECT (SELECT count(*) FROM audit_log) audits,(SELECT count(*) FROM event_log) events,(SELECT count(*) FROM administration_command_receipts) receipts").get()).toEqual({audits:1,events:1,receipts:1});
    expect(()=>f.run({...c,commandId:id()})).toThrow('ADMINISTRATION_VERSION_CONFLICT');}finally{f.sqlite.close();}});
  it('requires price re-entry coherence and permanently rejects currency change after finance',()=>{const f=fixture();try{
    f.sqlite.exec("INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES('tax','Tax',0,'TAX_ADDED'); INSERT INTO products(id,name,tax_profile_id,base_price_amount,base_price_currency) VALUES('product','P','tax',1,'MXN')");
    expect(()=>f.run({kind:'SET_CURRENCY',commandId:id(),expectedVersion:1,reason:'Select currency',currency:'USD'})).toThrow('CURRENCY_PRICE_REENTRY_REQUIRED');
    expect(f.run({kind:'SET_CURRENCY',commandId:id(),expectedVersion:1,reason:'Select currency',currency:'MXN'}).version).toBe(2);
    f.sqlite.prepare("INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at) VALUES(?,?,?,?,?,'1','MXN','CLOSED',1,1)")
      .run(id(),f.binding.tenantId,f.binding.locationId,'COUNTER','POS');
    expect(()=>f.run({kind:'SET_CURRENCY',commandId:id(),expectedVersion:2,reason:'Try relabel',currency:'USD'})).toThrow('CURRENCY_LOCKED');}finally{f.sqlite.close();}});
  it('blocks business-day changes with open orders and accepts a real IANA policy once quiescent',()=>{const f=fixture();try{const order=id();f.sqlite.prepare("INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at) VALUES(?,?,?,?,?,'1','MXN','OPEN',1,1)").run(order,f.binding.tenantId,f.binding.locationId,'COUNTER','POS');
    const c={kind:'SET_BUSINESS_DAY_POLICY',commandId:id(),expectedVersion:1,reason:'Set operating day',timeZone:'America/Matamoros',rollover:'04:00'} as const;
    expect(()=>f.run(c)).toThrow('BUSINESS_DAY_POLICY_IN_USE');f.sqlite.prepare("UPDATE orders SET status='CANCELLED'").run();expect(f.run({...c,commandId:id()}).version).toBe(2);
    expect(()=>f.run({...c,commandId:id(),expectedVersion:2,timeZone:'UTC+6'})).toThrow('BUSINESS_TIME_ZONE_INVALID');}finally{f.sqlite.close();}});
  it('maps exact legacy zone names to UUID zones without changing table text',()=>{const db=new Database(':memory:');try{for(const name of readdirSync(directory).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=15).sort())db.exec(readFileSync(join(directory,name),'utf8'));
    const binding={tenantId:id(),locationId:id(),edgeId:id()};db.prepare("INSERT INTO restaurant_tables(id,tenant_id,location_id,name,zone) VALUES(?,?,?,?,?)").run(id(),binding.tenantId,binding.locationId,'Mesa','Salón');
    initializeLegacyAdministrationBaseline(db,binding);const row=db.prepare('SELECT t.zone,z.name,t.zone_id zoneId FROM restaurant_tables t JOIN zones z ON z.id=t.zone_id').get() as {zone:string;name:string;zoneId:string};
    expect(row).toMatchObject({zone:'Salón',name:'Salón'});expect(()=>EntityId.fromString(row.zoneId)).not.toThrow();}finally{db.close();}});
  it('blocks default/register and table mutations while active work exists',()=>{const f=fixture();try{
    f.run({kind:'SET_CURRENCY',commandId:id(),expectedVersion:1,reason:'Select currency',currency:'MXN'});const cash=f.run({kind:'CREATE_CASH_REGISTER',commandId:id(),expectedVersion:0,reason:'Create register',name:'Caja',blindCashCount:true,makeDefault:true,displayOrder:0});
    f.sqlite.prepare("INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES(?,?,?,?,?,'x',1)").run(id(),f.binding.tenantId,f.binding.locationId,'Owner','ACTIVE');
    const zone=f.run({kind:'CREATE_ZONE',commandId:id(),expectedVersion:0,reason:'Create zone',name:'Main',displayOrder:0}),table=f.run({kind:'CREATE_TABLE',commandId:id(),expectedVersion:0,reason:'Create table',zoneId:zone.entityId,name:'One',capacity:4,displayOrder:0});
    const order=id();f.sqlite.prepare("INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at) VALUES(?,?,?,?,?,'1','MXN','OPEN',1,1)").run(order,f.binding.tenantId,f.binding.locationId,'TABLE','POS');
    f.sqlite.prepare('INSERT INTO order_table_assignments(id,order_id,table_id,assigned_at) VALUES(?,?,?,1)').run(id(),order,table.entityId);
    expect(()=>f.run({kind:'UPDATE_TABLE',commandId:id(),expectedVersion:1,reason:'Move table',tableId:table.entityId,zoneId:zone.entityId,name:'Two',capacity:4,active:true,displayOrder:1})).toThrow('TABLE_HAS_ACTIVE_ORDER');
    expect(cash.version).toBe(1);}finally{f.sqlite.close();}});
});
