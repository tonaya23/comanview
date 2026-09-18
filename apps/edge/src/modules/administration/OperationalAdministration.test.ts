import Database from 'better-sqlite3';import { drizzle } from 'drizzle-orm/better-sqlite3';import { readFileSync,readdirSync } from 'node:fs';import { fileURLToPath } from 'node:url';import { join } from 'node:path';
import { describe,expect,it,vi } from 'vitest';import { EntityId,resolveBusinessDate } from '@comanview/domain';import * as schema from '@comanview/database/edge';
import { CashRepository,PrintJobRepository,RestaurantAdministrationRepository,initializeLegacyAdministrationBaseline,EdgeControlRepository } from '@comanview/database';
import { AdministrationService } from './AdministrationService.js';import { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';import { CashService } from '../cash/application/CashService.js';
import { defaultOperationalContext } from '../../app/operationalContext.js';import type { AuthenticatedActor,AuthorizedOperation } from '../../app/authContext.js';
const directory=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url)),id=()=>EntityId.generate().toString();
function fixture(){const sqlite=new Database(':memory:');for(const name of readdirSync(directory).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=15).sort())sqlite.exec(readFileSync(join(directory,name),'utf8'));
  const binding={tenantId:id(),locationId:id(),edgeId:id()};sqlite.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)").run(binding.edgeId,binding.tenantId,binding.locationId);initializeLegacyAdministrationBaseline(sqlite,binding);
  const db=drizzle(sqlite,{schema}),licensing=new EdgeLicenseManager(new EdgeControlRepository(db),null,{enforcementEnabled:false,publicKeyring:{},pullIntervalMs:1,maxBackoffMs:1,checkpointIntervalMs:1},binding),admin=new AdministrationService(new RestaurantAdministrationRepository(db),binding,licensing);
  const actor={userId:id(),sessionId:id(),deviceId:id(),tenantId:binding.tenantId,locationId:binding.locationId,displayName:'Owner',roles:['OWNER'],permissions:['ADMINISTRATION_VIEW','BUSINESS_DAY_POLICY_MANAGE','CURRENCY_MANAGE','CASH_REGISTER_MANAGE','TIP_PREFERENCES_MANAGE']} as AuthenticatedActor;
  const operation:AuthorizedOperation={actor,authorizedBy:null,permission:'CASH_SESSION_OPEN',requestedAt:new Date('2026-09-02T10:00:00.000Z')};return{sqlite,db,binding,admin,actor,operation,licensing};}
describe('operational administration integration',()=>{
  it('uses persisted currency/default register and lets only Edge validate business_date',async()=>{const f=fixture();try{let version=1;
    version=(await f.admin.execute({kind:'SET_CURRENCY',commandId:id(),expectedVersion:version,reason:'Choose currency',currency:'MXN'},f.actor)).version;
    version=(await f.admin.execute({kind:'SET_BUSINESS_DAY_POLICY',commandId:id(),expectedVersion:version,reason:'Choose business day',timeZone:'America/Matamoros',rollover:'04:00'},f.actor)).version;
    f.admin.execute({kind:'CREATE_CASH_REGISTER',commandId:id(),expectedVersion:0,reason:'Create main register',name:'Main',blindCashCount:true,makeDefault:true,displayOrder:0},f.actor);
    const service=new CashService(new CashRepository(f.db),new PrintJobRepository(f.db),{...defaultOperationalContext,...f.binding},f.licensing,undefined,f.admin),actual=resolveBusinessDate({operationalTimezone:'America/Matamoros',rollover:'04:00',version:1},f.operation.requestedAt);
    expect(()=>service.openSession({commandId:id(),openingFloatAmount:0,businessDate:'2000-01-01'},f.operation)).toThrow(expect.objectContaining({code:'BUSINESS_DATE_MISMATCH'}));
    expect(service.openSession({commandId:id(),openingFloatAmount:0,businessDate:actual},f.operation).businessDate).toBe(actual);
    expect(JSON.parse((f.sqlite.prepare('SELECT business_day_policy_json policy FROM cash_sessions').get() as {policy:string}).policy)).toEqual({operationalTimezone:'America/Matamoros',rollover:'04:00',version:1});
  }finally{f.sqlite.close();}});
  it('preserves legacy tip behavior when Cloud did not delegate and rejects local preference mutation',()=>{const f=fixture();try{expect(f.admin.effectiveTips()).toMatchObject({ownerConfigurable:false,tipsEnabled:true});
    expect(()=>f.admin.execute({kind:'SET_TIP_PREFERENCES',commandId:id(),expectedVersion:1,reason:'Try local tips',preferences:{enabled:true,percentageOptionsBasisPoints:[1000],fixedAmountEnabled:true}},f.actor)).toThrow(expect.objectContaining({code:'TIP_POLICY_NOT_DELEGATED'}));
  }finally{f.sqlite.close();}});
  it('allows only an Owner preference subset explicitly delegated by signed Cloud policy',()=>{const f=fixture();try{vi.spyOn(f.licensing,'currentConfiguration').mockReturnValue({payment:{tipsEnabled:true,tipPercentageOptionsBasisPoints:[1000,1500]},
      tipPolicy:{ownerConfigurable:true,allowPercentages:true,allowedPercentagesBasisPoints:[1000,1500],allowFixedAmount:false}});
    f.admin.execute({kind:'SET_TIP_PREFERENCES',commandId:id(),expectedVersion:1,reason:'Choose allowed tips',preferences:{enabled:true,percentageOptionsBasisPoints:[1500],fixedAmountEnabled:false}},f.actor);
    expect(f.admin.effectiveTips()).toEqual({tipsEnabled:true,percentageOptionsBasisPoints:[1500],fixedAmountEnabled:false,ownerConfigurable:true});
    expect(()=>f.admin.execute({kind:'SET_TIP_PREFERENCES',commandId:id(),expectedVersion:2,reason:'Try disallowed tips',preferences:{enabled:true,percentageOptionsBasisPoints:[2000],fixedAmountEnabled:false}},f.actor))
      .toThrow(expect.objectContaining({code:'TIP_PREFERENCES_OUTSIDE_POLICY'}));
  }finally{vi.restoreAllMocks();f.sqlite.close();}});
});
